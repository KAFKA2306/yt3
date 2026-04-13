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
		const firstTopic = allTopics[0];
		const result: ResearchResult = {
			director_data: {
				angle: firstTopic?.angle || "",
				title_hook:
					firstTopic?.results[0]?.title_hook ||
					firstTopic?.selected_topic ||
					"",
				search_query: firstTopic?.search_query || "",
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
}
