import path from "node:path";
import fs from "fs-extra";
import {
	type AssetStore,
	BaseAgent,
	AgentLogger as Logger,
	RunStage,
	loadConfig,
	parseLlmJson,
} from "../../io/core.js";
import { ScriptIntegrityLinter } from "../../io/utils/qa/script_linter.js";
import {
	type AgentState,
	type ContentOutline,
	ContentOutlineSchema,
	type ContentResult,
	ContentSegmentSchema,
	type Metadata,
	MetadataSchema,
	type NewsItem,
	type ScriptLine,
	type StrategicAnalysis,
} from "../types.js";

interface ContentPrompts {
	outline: { system: string; user_template: string };
	segment: { system: string; user_template: string };
	metadata: { system: string; user_template: string };
}

export class ScriptSmith extends BaseAgent {
	constructor(store: AssetStore) {
		const cfg = loadConfig();
		super(store, RunStage.CONTENT, {
			temperature: cfg.providers.llm.content?.temperature || 0.4,
		});
	}

	async run(
		news: NewsItem[],
		director: { angle: string; title_hook: string; channel_type?: string },
		context: string,
		strategic_insight?: StrategicAnalysis,
	): Promise<ContentResult> {
		const outputPath = path.join(
			this.store.runDir,
			this.name,
			this.store.cfg.workflow.filenames.output,
		);
		if (fs.existsSync(outputPath)) {
			const res = this.store.load<ContentResult>(this.name, "output");
			if (!res) throw new Error("No content output found");
			this.logOutput(res);
			return res;
		}

		this.logInput({ news, director, context, strategic_insight });

		const newsContext = news
			.map((n) => `Title: ${n.title}\nSource: ${n.url}\nSummary: ${n.summary}`)
			.join("\n\n");

		const insightContext = strategic_insight
			? `\n\n**【投資戦略的示唆 (Chief Strategist's Insight)】**\n戦略要約: ${strategic_insight.strategic_summary}\n主要な知恵:\n${strategic_insight.insights.map((i: { wisdom: string }) => `- ${i.wisdom}`).join("\n")}`
			: "";

		const fullContext = newsContext + insightContext;
		let channelType = director.channel_type || "default";
		if (channelType === "default" || !channelType) {
			if (this.store.runDir.includes("humanity_observatory")) {
				channelType = "humanity_observatory";
			} else if (this.store.runDir.includes("yawa_archive")) {
				channelType = "yawa_archive";
			}
		}

		let attempt = 0;
		const maxAttempts = 3;
		let lastErrorFeedback = "";
		let result: ContentResult | null = null;

		while (attempt < maxAttempts) {
			attempt++;
			Logger.info(
				this.name,
				"CONTENT",
				"GENERATE_ATTEMPT",
				`Attempt ${attempt}/${maxAttempts}`,
			);

			try {
				const outline = await this.generateOutline(
					director.angle,
					fullContext,
					channelType,
					lastErrorFeedback,
				);
				Logger.info(
					this.name,
					"CONTENT",
					"OUTLINE_GEN",
					`Generated outline: ${outline.title}`,
				);

				let allLines: ScriptLine[] = [];
				for (const section of outline.sections) {
					const segmentLines = await this.generateSegment(
						director.angle,
						section,
						allLines,
						fullContext,
						channelType,
						lastErrorFeedback,
					);
					allLines = [...allLines, ...segmentLines];
				}

				const scriptText = allLines
					.map((l) => `${l.speaker}: ${l.text}`)
					.join("\n");
				const metadata = await this.generateMetadata(
					scriptText,
					fullContext,
					channelType,
				);

				result = {
					script: {
						title: outline.title,
						description: metadata.description,
						lines: allLines,
						total_duration: 0,
					},
					metadata,
				};

				// Run linter validation
				const linter = new ScriptIntegrityLinter();
				const linterState: Partial<AgentState> = {
					script: result.script,
					metadata,
					news,
					bucket: channelType,
				};

				const auditRes = await linter.audit(linterState as AgentState);
				const relevantChecks = auditRes.checks.filter(
					(c) => c.layer !== "Artifact",
				);
				const passed = relevantChecks.every((c) => c.status !== "FAIL");

				if (passed) {
					Logger.info(
						this.name,
						"CONTENT",
						"AUDIT_PASS",
						`Script passed integrity linter (Score: ${auditRes.score}/100, content-phase)`,
					);
					break;
				}
				const failedChecks = relevantChecks
					.filter((c) => c.status === "FAIL" || c.status === "WARN")
					.map(
						(c) =>
							`- ${c.layer}: ${c.message} (${c.details ? c.details.join(", ") : ""})`,
					)
					.join("\n");
				lastErrorFeedback = `【警告】前回の生成台本は品質チェックに失敗しました。以下を確実に改善し、反復を避け、より自然な対話・解説にしてください：\n${failedChecks}`;
				Logger.warn(
					this.name,
					"CONTENT",
					"AUDIT_FAIL",
					`Script failed integrity linter (Score: ${auditRes.score}/100). Feedback:\n${lastErrorFeedback}`,
				);
				result = null; // Reset result to retry
			} catch (e: unknown) {
				const errMsg = e instanceof Error ? e.message : String(e);
				Logger.error(
					this.name,
					"CONTENT",
					"GENERATE_ERROR",
					`Attempt ${attempt} failed with error: ${errMsg}`,
				);
				lastErrorFeedback = `【エラー】前回の生成中にエラーが発生しました：${errMsg}`;
				result = null;
			}
		}

		if (!result) {
			throw new Error(
				`CRITICAL: Failed to generate a script passing integrity audits after ${maxAttempts} attempts.`,
			);
		}

		this.logOutput(result);
		return result;
	}

	private async generateOutline(
		angle: string,
		newsContext: string,
		channelType: string,
		feedback = "",
	): Promise<ContentOutline> {
		const prompts = this.loadPrompt<ContentPrompts>(
			channelType === "humanity_observatory"
				? "humanity_observatory"
				: this.name,
		);
		const userPrompt =
			prompts.outline.user_template
				.replace("{angle}", angle)
				.replace("{news_context}", newsContext) +
			(feedback ? `\n\n${feedback}` : "");

		return this.runLlm(prompts.outline.system, userPrompt, (text) =>
			parseLlmJson(text, ContentOutlineSchema),
		);
	}

	private async generateSegment(
		angle: string,
		section: ContentOutline["sections"][0],
		prevLines: ScriptLine[],
		newsContext: string,
		channelType: string,
		feedback = "",
	): Promise<ScriptLine[]> {
		const prompts = this.loadPrompt<ContentPrompts>(
			channelType === "humanity_observatory"
				? "humanity_observatory"
				: this.name,
		);
		const prevContext =
			prevLines.length > 0
				? prevLines.map((l) => `${l.speaker}: ${l.text}`).join("\n")
				: "（対話開始）";

		const userPrompt =
			prompts.segment.user_template
				.replace("{angle}", angle)
				.replace("{section_title}", section.title)
				.replace("{key_points}", section.key_points.join(", "))
				.replace("{target_chars}", section.target_character_count.toString())
				.replace("{previous_context}", prevContext)
				.replace("{news_context}", newsContext) +
			(feedback ? `\n\n${feedback}` : "");

		const res = await this.runLlm(prompts.segment.system, userPrompt, (text) =>
			parseLlmJson(text, ContentSegmentSchema),
		);

		const processedLines: ScriptLine[] = [];
		for (const l of res.lines) {
			const textChunks = splitLongText(l.text, 120);
			for (const chunk of textChunks) {
				processedLines.push({
					speaker: l.speaker,
					text: chunk,
					duration: 0,
				});
			}
		}
		return processedLines;
	}

	private async generateMetadata(
		scriptText: string,
		newsContext: string,
		channelType: string,
	): Promise<Metadata> {
		const prompts = this.loadPrompt<ContentPrompts>(
			channelType === "humanity_observatory"
				? "humanity_observatory"
				: this.name,
		);

		return this.runLlm(
			prompts.metadata.system,
			prompts.metadata.user_template
				.replace("{script_text}", scriptText)
				.replace("{news_sources}", newsContext),
			(text) => parseLlmJson(text, MetadataSchema),
		);
	}
}

function splitLongText(text: string, maxLength = 120): string[] {
	if (text.length <= maxLength) return [text];

	const sentences = text.split(/(?<=[。！？\n])/g);
	const chunks: string[] = [];
	let currentChunk = "";

	for (const sentence of sentences) {
		if (!sentence.trim()) continue;
		if ((currentChunk + sentence).length <= maxLength) {
			currentChunk += sentence;
		} else {
			if (currentChunk) {
				chunks.push(currentChunk.trim());
			}
			if (sentence.length > maxLength) {
				let subSentence = sentence;
				while (subSentence.length > maxLength) {
					let splitIdx = subSentence.slice(0, maxLength).lastIndexOf("、");
					if (splitIdx === -1) {
						splitIdx = maxLength;
					} else {
						splitIdx += 1;
					}
					chunks.push(subSentence.slice(0, splitIdx).trim());
					subSentence = subSentence.slice(splitIdx);
				}
				currentChunk = subSentence;
			} else {
				currentChunk = sentence;
			}
		}
	}
	if (currentChunk) {
		chunks.push(currentChunk.trim());
	}
	return chunks;
}
