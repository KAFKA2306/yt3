import path from "node:path";
import fs from "fs-extra";
import {
	type AssetStore,
	BaseAgent,
	AgentLogger as Logger,
	QuotaExhaustionError,
	RunStage,
	loadConfig,
	parseLlmJson,
} from "../../io/core.js";
import {
	type DiscomfortLinterResult,
	ScriptIntegrityLinter,
} from "../../io/utils/qa/script_linter.js";
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

				allLines = this.normalizeScriptLines(allLines, channelType);
				const dialogueBalance = this.measureDialogueBalance(allLines);
				if (dialogueBalance.needsRepair) {
					lastErrorFeedback = [
						"【警告】会話バランスがまだ偏っています。",
						`最大話者比率: ${(dialogueBalance.maxSpeakerRatio * 100).toFixed(1)}%`,
						`最長連続発話: ${dialogueBalance.longestRun} 行`,
						"次の試行では、必ず2人以上が交互に話し、同じ話者の独白を続けないでください。",
					].join("\n");
					Logger.warn(
						this.name,
						"CONTENT",
						"AUDIENCE_BALANCE_FAIL",
						`Script still skewed after repair (ratio=${dialogueBalance.maxSpeakerRatio.toFixed(
							3,
						)}, run=${dialogueBalance.longestRun}). Retrying.`,
					);
					result = null;
					continue;
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
				lastErrorFeedback = this.buildRetryFeedback(
					auditRes.score,
					relevantChecks,
					failedChecks,
				);
				Logger.warn(
					this.name,
					"CONTENT",
					"AUDIT_FAIL",
					`Script failed integrity linter (Score: ${auditRes.score}/100). Feedback:\n${lastErrorFeedback}`,
				);
				result = null; // Reset result to retry
			} catch (e: unknown) {
				const errMsg = e instanceof Error ? e.message : String(e);
				if (
					e instanceof QuotaExhaustionError ||
					this.isQuotaExhaustionMessage(errMsg)
				) {
					Logger.error(
						this.name,
						"CONTENT",
						"QUOTA_TERMINAL",
						`LLM quota exhausted; fallback content generation is prohibited: ${errMsg}`,
					);
					throw new QuotaExhaustionError(
						`CRITICAL: Content generation stopped after quota exhaustion. Deterministic fallback content is prohibited. Original error: ${errMsg}`,
					);
				}
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

	private buildRetryFeedback(
		score: number,
		checks: DiscomfortLinterResult["checks"],
		failedChecks: string,
	): string {
		const notes: string[] = [
			`【警告】前回の生成台本は品質チェックに失敗しました（Score: ${score}/100）。`,
			"次の試行では、数字の量ではなく、視聴者が『自分のことだ』と感じる一文を優先してください。",
		];

		const factPlausibility = checks.find((c) => c.layer === "FactPlausibility");
		if (factPlausibility?.status === "FAIL") {
			notes.push(
				"FactPlausibility: ソースに明示されていない数字や年号を削除し、各セクションにつき1つだけ、裏取りできる数値を残してください。",
			);
		}

		const metricDensity = checks.find((c) => c.layer === "MetricDensity");
		if (metricDensity?.status === "WARN") {
			notes.push(
				"MetricDensity: 数字を増やすより、生活への影響、感情の動き、次の行動を先に置いてください。",
			);
		}

		const metadataLeakage = checks.find((c) => c.layer === "MetadataLeakage");
		if (metadataLeakage?.status === "FAIL") {
			notes.push(
				"MetadataLeakage: source_tier / source_identifier / URL などの出典メモを台詞本文に書かず、概要欄か参照欄だけに残してください。",
			);
		}

		const repetition = checks.find((c) => c.layer === "Repetition");
		if (repetition?.status === "FAIL") {
			notes.push(
				"Repetition: 同じ始まり方を避け、別の事実・別の問い・別の比喩で入り直してください。",
			);
		}

		const structure = checks.find((c) => c.layer === "Structure");
		if (structure?.status === "FAIL") {
			notes.push(
				"Structure: 導入と結びを1回ずつに整理し、重複する挨拶や締めを削ってください。",
			);
		}

		const dialogue = checks.find((c) => c.layer === "Dialogue");
		if (dialogue?.status === "WARN") {
			notes.push(
				"Dialogue: 驚き→疑問→解説の繰り返しを避け、会話の速度と温度を変えてください。",
			);
		}

		notes.push(`改善対象:\n${failedChecks}`);
		return notes.join("\n");
	}

	private isQuotaExhaustionMessage(message: string): boolean {
		const lower = message.toLowerCase();
		return (
			lower.includes("quota exhaustion") ||
			lower.includes("rate limit") ||
			lower.includes("llm invocation failed after 5 attempts")
		);
	}

	private normalizeScriptLines(
		lines: ScriptLine[],
		channelType: string,
	): ScriptLine[] {
		const cleaned = lines
			.map((line) => ({
				...line,
				speaker: line.speaker.trim(),
				text: this.stripEmbeddedSourceMetadata(line.text),
				duration: 0,
			}))
			.filter((line) => line.text.length > 0);

		const speakers = this.getPreferredDialogueSpeakers(cleaned, channelType);
		if (speakers.length < 2) {
			return cleaned;
		}

		const balance = this.measureDialogueBalance(cleaned);
		if (!balance.needsRepair) {
			return cleaned;
		}

		const repaired = this.rebalanceDialogueLines(cleaned, speakers);
		Logger.warn(
			this.name,
			"CONTENT",
			"SCRIPT_REPAIR",
			`Rebalanced script dialogue to reduce speaker skew (${balance.maxSpeakerRatio.toFixed(
				3,
			)} -> ${this.measureDialogueBalance(repaired).maxSpeakerRatio.toFixed(3)}).`,
		);
		return repaired;
	}

	private stripEmbeddedSourceMetadata(text: string): string {
		const normalized = text
			.replace(
				/(?:^|\s)source_tier:\s*\d+\s*,?\s*(?:source_identifier|source_url)?[^。！？\n]*/gi,
				" ",
			)
			.replace(/(?:^|\s)source_identifier:\s*[^。！？\n]*/gi, " ")
			.replace(/(?:^|\s)source_url:\s*[^。！？\n]*/gi, " ")
			.replace(/\s+/g, " ")
			.trim();

		if (/^(source_tier|source_identifier|source_url)\s*:/i.test(normalized)) {
			return "";
		}

		return normalized;
	}

	private getPreferredDialogueSpeakers(
		lines: ScriptLine[],
		channelType: string,
	): string[] {
		if (channelType === "humanity_observatory") {
			return ["雨晴はう", "もち子さん"];
		}

		const seen = new Set<string>();
		const fromLines = lines
			.map((line) => line.speaker)
			.filter((speaker) => {
				if (!speaker || seen.has(speaker)) return false;
				seen.add(speaker);
				return true;
			});

		if (fromLines.length >= 2) {
			return fromLines;
		}

		const configSpeakers = Object.values(this.store.cfg.steps.script.speakers)
			.map((speaker) => speaker.name)
			.filter(
				(speaker, index, array) => speaker && array.indexOf(speaker) === index,
			);

		return configSpeakers.length > 0 ? configSpeakers : fromLines;
	}

	private measureDialogueBalance(lines: ScriptLine[]): {
		maxSpeakerRatio: number;
		longestRun: number;
		needsRepair: boolean;
	} {
		const speakerCharCounts: Record<string, number> = {};
		let longestRun = 0;
		let currentSpeaker = "";
		let currentRun = 0;

		for (const line of lines) {
			speakerCharCounts[line.speaker] =
				(speakerCharCounts[line.speaker] || 0) + line.text.length;
			if (line.speaker === currentSpeaker) {
				currentRun += 1;
			} else {
				currentSpeaker = line.speaker;
				currentRun = 1;
			}
			if (currentRun > longestRun) longestRun = currentRun;
		}

		const totalCharCount = Object.values(speakerCharCounts).reduce(
			(a, b) => a + b,
			0,
		);
		const maxSpeakerRatio =
			totalCharCount > 0
				? Math.max(...Object.values(speakerCharCounts)) / totalCharCount
				: 0;

		return {
			maxSpeakerRatio,
			longestRun,
			needsRepair: maxSpeakerRatio > 0.78 || longestRun > 2,
		};
	}

	private rebalanceDialogueLines(
		lines: ScriptLine[],
		speakers: string[],
	): ScriptLine[] {
		const pool = speakers.filter((speaker, index, array) => {
			return speaker.length > 0 && array.indexOf(speaker) === index;
		});
		if (pool.length < 2) {
			return lines;
		}

		const totals = new Map<string, number>(pool.map((speaker) => [speaker, 0]));
		const output: ScriptLine[] = [];
		let lastSpeaker = "";
		let streak = 0;

		for (const line of lines) {
			const textLength = line.text.length;
			const availableSpeakers =
				lastSpeaker && streak >= 2
					? pool.filter((speaker) => speaker !== lastSpeaker)
					: pool;
			const candidatePool =
				availableSpeakers.length > 0 ? availableSpeakers : pool;
			const bestSpeaker = [...candidatePool].sort((a, b) => {
				const totalDiff = (totals.get(a) || 0) - (totals.get(b) || 0);
				if (totalDiff !== 0) return totalDiff;
				return a.localeCompare(b, "ja");
			})[0];
			if (!bestSpeaker) {
				return lines;
			}

			let speaker: string = bestSpeaker;
			if (
				pool.includes(line.speaker) &&
				!(lastSpeaker && streak >= 2 && line.speaker === lastSpeaker)
			) {
				const currentTotal = totals.get(line.speaker) || 0;
				const bestTotal = totals.get(bestSpeaker) || 0;
				if (currentTotal <= bestTotal * 1.15) {
					speaker = line.speaker;
				}
			}

			totals.set(speaker, (totals.get(speaker) || 0) + textLength);
			if (speaker === lastSpeaker) {
				streak += 1;
			} else {
				lastSpeaker = speaker;
				streak = 1;
			}
			output.push({ ...line, speaker });
		}

		return output;
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
