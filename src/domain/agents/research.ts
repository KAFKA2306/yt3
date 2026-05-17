import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import {
	type AssetStore,
	BaseAgent,
	AgentLogger as Logger,
	ROOT,
	RunStage,
	fetchRecentThemes,
	getCurrentDateString,
	loadConfig,
	loadMemoryContext,
	parseLlmJson,
} from "../../io/core.js";
import {
	type EditorSelection,
	EditorSelectionSchema,
	type NewsItem,
	NewsItemSchema,
	type ResearchDeepDive,
	ResearchDeepDiveSchema,
	type ScriptLine,
} from "../types.js";
export interface ResearchResult {
	director_data: {
		angle: string;
		title_hook: string;
		search_query: string;
		key_questions: string[];
	};
	news: NewsItem[];
	memory_context: string;
}
interface Mission {
	topic: string;
	search_queries: string[];
	angles: Array<{ name: string; focus: string }>;
}

export class TrendScout extends BaseAgent {
	constructor(store: AssetStore) {
		const cfg = loadConfig();
		super(store, RunStage.RESEARCH, {
			temperature: cfg.steps.research?.temperature || 0.5,
		});
	}
	async run(
		bucket: string,
		limit?: number,
		missionFile?: string,
	): Promise<ResearchResult> {
		const cached = this.store.load<ResearchResult>(this.name, "output");
		if (cached) return cached;
		const researchCfg = this.config.steps.research;
		if (!researchCfg) throw new Error("Research config missing");
		this.logInput({
			bucket,
			limit: limit || researchCfg.default_limit || 3,
		});
		const recent = loadMemoryContext(this.store);

		const promptCfg = this.loadPrompt<{
			consolidated_research: { system: string; user_template: string };
		}>(this.name);
		const currentDate = getCurrentDateString();
		const recentThemes = fetchRecentThemes(this.store, 7);
		let userPrompt = promptCfg.consolidated_research.user_template
			.replace(
				"{regions}",
				researchCfg.regions.map((r: { lang: string }) => r.lang).join(", "),
			)
			.replace("{recent_topics}", recent)
			.replace("{recent_themes}", recentThemes)
			.replace("{current_date}", currentDate);

		const pulseFile = missionFile || path.join(ROOT, "pulse.md");
		if (fs.existsSync(pulseFile)) {
			const customNewsContext = fs.readFileSync(pulseFile, "utf8");
			userPrompt += `\n\n[DAILY PULSE SOVEREIGNTY DATA]\n${customNewsContext}\n(Analyze this data as the SOLE source of truth for today's video. You MUST format this data into the requested JSON schema without adding unrelated news.)`;
			Logger.info(
				this.name,
				"RESEARCH",
				"PULSE",
				"Using pulse.md as primary source",
			);
		}

		const research = await this.runLlm<{
			selected_topics: Array<{
				category: string;
				selected_topic: string;
				reason: string;
				angle: string;
				search_query: string;
				results: Array<{
					angle: string;
					title_hook: string;
					key_questions: string[];
					news: NewsItem[];
				}>;
			}>;
		}>(
			promptCfg.consolidated_research.system
				.replace(
					"{regions}",
					researchCfg.regions.map((r: { lang: string }) => r.lang).join(", "),
				)
				.replace("{current_date}", currentDate),
			userPrompt,
			(t) =>
				parseLlmJson(
					t,
					z.object({
						selected_topics: z.array(
							z.object({
								category: z.string(),
								selected_topic: z.string(),
								reason: z.string(),
								angle: z.string(),
								search_query: z.string(),
								results: z.array(
									z.object({
										angle: z.string(),
										title_hook: z.string(),
										key_questions: z.array(z.string()),
										news: z.array(NewsItemSchema),
									}),
								),
							}),
						),
					}),
				),
			{ extra: { tools: [{ googleSearchRetrieval: {} }] } },
		);

		const allTopics = research.selected_topics || [];
		const pastRuns = this.getPastRunsState();
		const pastTitles = pastRuns.map((run) => run.title).filter(Boolean);

		let selectedTopic = allTopics[0];
		let selectedResult = selectedTopic?.results?.[0];

		if (allTopics.length > 0) {
			let minSimilarity = 1.0;
			for (const topic of allTopics) {
				for (const r of topic.results || []) {
					const currentTitle = r.title_hook || topic.selected_topic || "";
					if (!currentTitle) continue;

					let maxTitleSim = 0;
					for (const pastTitle of pastTitles) {
						const sim = calculateStringSimilarity(currentTitle, pastTitle);
						if (sim > maxTitleSim) {
							maxTitleSim = sim;
						}
					}

					if (maxTitleSim < minSimilarity) {
						minSimilarity = maxTitleSim;
						selectedTopic = topic;
						selectedResult = r;
					}
				}
			}
		}

		const result: ResearchResult = {
			director_data: {
				angle: selectedResult?.angle || selectedTopic?.angle || "",
				title_hook:
					selectedResult?.title_hook || selectedTopic?.selected_topic || "",
				search_query: selectedTopic?.search_query || "",
				key_questions: allTopics
					.flatMap((topic) => topic.results)
					.flatMap((r) => r.key_questions)
					.slice(0, 5),
			},
			news: allTopics
				.flatMap((topic) => topic.results)
				.flatMap((r) => r.news)
				.filter((n: NewsItem) => n?.title),
			memory_context: recent,
		};
		this.logOutput(result);
		return result;
	}

	private getPastRunsState(): Array<{
		run_id: string;
		title: string;
		script: string;
	}> {
		const pastRuns: Array<{ run_id: string; title: string; script: string }> =
			[];
		try {
			const runsDir = path.join(ROOT, "runs");
			if (!fs.existsSync(runsDir)) return pastRuns;
			const dirs = fs.readdirSync(runsDir).filter((name) => {
				const fullPath = path.join(runsDir, name);
				return (
					fs.statSync(fullPath).isDirectory() &&
					name !== "runs" &&
					name !== "audit-demo" &&
					name !== "--run-id"
				);
			});
			for (const dir of dirs) {
				const statePath = path.join(runsDir, dir, "state.json");
				if (fs.existsSync(statePath)) {
					try {
						const runState = fs.readJsonSync(statePath);
						const title =
							runState.script?.title || runState.metadata?.title || "";
						const lines = runState.script?.lines || [];
						const scriptText = lines
							.map((l: ScriptLine) => `${l.speaker}: ${l.text}`)
							.join("\n");
						if (title || scriptText) {
							pastRuns.push({
								run_id: dir,
								title,
								script: scriptText.substring(0, 1000),
							});
						}
					} catch {
						// ignore individual parsing failures
					}
				}
			}
		} catch (e) {
			console.error("Failed to read past runs states:", e);
		}
		return pastRuns;
	}
}

function calculateStringSimilarity(str1: string, str2: string): number {
	const set1 = new Set(str1.split(""));
	const set2 = new Set(str2.split(""));
	const intersection = new Set([...set1].filter((x) => set2.has(x)));
	const union = new Set([...set1, ...set2]);
	if (union.size === 0) return 0;
	return intersection.size / union.size;
}
