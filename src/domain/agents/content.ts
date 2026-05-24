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
import {
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

		const outline = await this.generateOutline(
			director.angle,
			fullContext,
			channelType,
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
				allLines.slice(-10),
				fullContext,
				channelType,
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

		const result: ContentResult = {
			script: {
				title: outline.title,
				description: metadata.description,
				lines: allLines,
				total_duration: 0,
			},
			metadata,
		};

		this.logOutput(result);
		return result;
	}

	private async generateOutline(
		angle: string,
		newsContext: string,
		channelType: string,
	): Promise<ContentOutline> {
		const prompts = this.loadPrompt<ContentPrompts>(
			channelType === "humanity_observatory"
				? "humanity_observatory"
				: this.name,
		);
		return this.runLlm(
			prompts.outline.system,
			prompts.outline.user_template
				.replace("{angle}", angle)
				.replace("{news_context}", newsContext),
			(text) => parseLlmJson(text, ContentOutlineSchema),
		);
	}

	private async generateSegment(
		angle: string,
		section: ContentOutline["sections"][0],
		prevLines: ScriptLine[],
		newsContext: string,
		channelType: string,
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

		const res = await this.runLlm(
			prompts.segment.system,
			prompts.segment.user_template
				.replace("{angle}", angle)
				.replace("{section_title}", section.title)
				.replace("{key_points}", section.key_points.join(", "))
				.replace("{target_chars}", section.target_character_count.toString())
				.replace("{previous_context}", prevContext)
				.replace("{news_context}", newsContext),
			(text) => parseLlmJson(text, ContentSegmentSchema),
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
