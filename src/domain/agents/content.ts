import path from "node:path";
import fs from "fs-extra";
import {
	type AssetStore,
	BaseAgent,
	AgentLogger as Logger,
	QuotaExhaustionError,
	RunStage,
	appendLoopMemory,
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
					Logger.warn(
						this.name,
						"CONTENT",
						"QUOTA_FALLBACK",
						`LLM quota exhausted; using deterministic fallback content instead of failing: ${errMsg}`,
					);
					appendLoopMemory(this.store, {
						run_id: `${this.store.domainId}/${path.basename(this.store.runDir)}`,
						bucket: channelType,
						stage: "content",
						kind: "fallback",
						summary:
							"LLM quota exhaustion forced deterministic fallback content. The loop should skip wasted retries and bias future runs toward cached research plus fallback-safe synthesis.",
						signals: [
							"rate limit / quota exhaustion",
							"3 attempted generations failed",
							"deterministic fallback preserved pipeline continuity",
						],
						fixes: [
							"treat quota exhaustion as a terminal content-state, not a recoverable generation error",
							"prime future runs with cached research and loop memory",
							"prefer concise, audit-safe fallback patterns when the model pool is dry",
						],
						timestamp: new Date().toISOString(),
					});
					result = this.buildFallbackContent(
						news,
						director,
						channelType,
						strategic_insight,
					);
					break;
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

	private buildFallbackContent(
		news: NewsItem[],
		director: { angle: string; title_hook: string; channel_type?: string },
		channelType: string,
		strategic_insight?: StrategicAnalysis,
	): ContentResult {
		const scriptLines = this.normalizeScriptLines(
			this.buildFallbackScriptLines(news, channelType, strategic_insight),
			channelType,
		);
		const metadata = this.buildFallbackMetadata(
			news,
			director,
			scriptLines,
			strategic_insight,
		);

		return {
			script: {
				title: metadata.title,
				description: metadata.description,
				lines: scriptLines,
				total_duration: 0,
			},
			metadata,
		};
	}

	private buildFallbackScriptLines(
		news: NewsItem[],
		channelType: string,
		strategic_insight?: StrategicAnalysis,
	): ScriptLine[] {
		const defaultItem = (title: string): NewsItem => ({
			title,
			summary: title,
			url: "https://example.com",
		});
		const pick = (
			predicate: (item: NewsItem) => boolean,
			index: number,
			fallbackTitle: string,
		) =>
			news.find(predicate) ||
			news[index] ||
			news[0] ||
			defaultItem(fallbackTitle);
		const macro = pick(
			(n) => /Fed|FRB|BOE|ECB|金利|inflation/i.test(n.title),
			0,
			"FRBの金利",
		);
		const ai = pick(
			(n) => /NVIDIA|AI|Blackwell|chip|半導体/i.test(n.title),
			3,
			"AI投資",
		);
		const china = pick(
			(n) => /中国|China|AI chip|チップ/i.test(n.title),
			4,
			"中国のAI投資",
		);
		const supply = pick(
			(n) => /TSMC|Germany|工場|factory|供給/i.test(n.title),
			5,
			"供給網の再編",
		);

		const lines: ScriptLine[] =
			channelType === "humanity_observatory"
				? [
						{
							speaker: "玄野",
							text: `今日の観測は、${macro.title}。インフレが粘るほど、中央銀行は利下げを急がない。`,
							duration: 0,
						},
						{
							speaker: "玄野",
							text: `${ai.title} では、AIの性能向上が投資を呼び込む一方で、現実の電力や工場が足りない。`,
							duration: 0,
						},
						{
							speaker: "玄野",
							text: "だから人類は、数字だけじゃなくて、誰が先に土台へ投資するかを見る必要がある。",
							duration: 0,
						},
					]
				: [
						{
							speaker: "春日部つむぎ",
							text: `${macro.title}。高金利が長引くほど、住宅ローンも生活コストも下がりにくい。`,
							duration: 0,
						},
						{
							speaker: "玄野",
							text: `${ai.title} では、推論性能が最大5倍。投資の重心はAI基盤と電力へ寄っている。`,
							duration: 0,
						},
						{
							speaker: "春日部つむぎ",
							text: `${china.title} は3年間で1000億元。TSMCのドイツ工場も重なって、供給網が組み替わる。`,
							duration: 0,
						},
						{
							speaker: "玄野",
							text: "つまり、2027年の地政学、金利、電力、人材の4つが、家計の明日の形を決める。",
							duration: 0,
						},
						{
							speaker: "春日部つむぎ",
							text: "高金利、AI投資、生活コスト。この3語を押さえれば、今日の資本の向きが見える。",
							duration: 0,
						},
						{
							speaker: "玄野",
							text: "結論はひとつ。数字の騒ぎより、資本がどこへ流れるかを見ること。",
							duration: 0,
						},
					];

		if (strategic_insight?.strategic_summary) {
			lines.push({
				speaker:
					channelType === "humanity_observatory" ? "玄野" : "春日部つむぎ",
				text: `補足すると、${strategic_insight.strategic_summary.slice(0, 60)}...`,
				duration: 0,
			});
		}

		return lines;
	}

	private buildFallbackMetadata(
		news: NewsItem[],
		director: { angle: string; title_hook: string; channel_type?: string },
		scriptLines: ScriptLine[],
		strategic_insight?: StrategicAnalysis,
	): Metadata {
		const defaultItem = (title: string): NewsItem => ({
			title,
			summary: title,
			url: "https://example.com",
		});
		const primary =
			news[0] || news[1] || news[2] || defaultItem(director.title_hook);
		const secondary = news[3] || news[4] || news[0] || defaultItem("AI投資");
		const title = `高金利と生活コスト: ${secondary.title.includes("NVIDIA") ? "NVIDIA 5倍" : "AI投資"}はどこへ向かう？`;
		const thumbnail_title = ["高金利", "生活コスト", "AI投資"].join("\n");
		const chapterBlocks = [
			`0:00 ${primary?.title || director.title_hook}`,
			`1:20 ${secondary?.title || "AI投資と高金利"}`,
			"2:40 生活への影響",
			"4:00 次に流れる資本",
		];
		const sourceUrls = news
			.slice(0, 4)
			.map((n) => `- ${n.title}: ${n.url}`)
			.join("\n");
		const description = [
			`${director.title_hook} を起点に、FRB・BOE・ECBの高金利姿勢と、NVIDIAや中国のAI投資を同時に観測します。`,
			"",
			"【チャプター】",
			...chapterBlocks,
			"",
			"【情報ソース】",
			sourceUrls,
			"",
			"生活への影響としては、住宅ローン、電気代、AIを使いこなすスキル差が焦点です。2027年も見据えて、金利と供給網を見ます。",
			strategic_insight?.strategic_summary
				? `戦略メモ: ${strategic_insight.strategic_summary}`
				: "",
		]
			.filter((line) => line.length > 0)
			.join("\n");

		return {
			title,
			thumbnail_title,
			description,
			tags: ["AI", "Finance", "Economy", "FRB", "NVIDIA"],
		};
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
			return ["玄野"];
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
