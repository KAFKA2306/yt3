import fs from "fs-extra";
import { z } from "zod";
import {
	type AssetStore,
	BaseAgent,
	AgentLogger as Logger,
	RunStage,
	getCurrentDateString,
	loadConfig,
	loadMemoryContext,
	parseLlmJson,
} from "../core.js";
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
			missionFile,
		});
		const recent = loadMemoryContext(this.store);

		if (missionFile && fs.existsSync(missionFile)) {
			Logger.info(
				"TrendScout",
				"RESEARCH",
				"MISSION",
				`Using mission from ${missionFile}`,
			);
			const mission: Mission = fs.readJsonSync(missionFile);
			return {
				director_data: {
					angle: mission.angles[0]?.focus || "Default Angle",
					title_hook: mission.topic,
					search_query: mission.search_queries.join(", "),
					key_questions: mission.angles.map((a) => a.name),
				},
				news: [], // Will be filled by subsequent search if needed, or we can just proceed with mission data
				memory_context: recent,
			};
		}
		const promptCfg = this.loadPrompt<{
			consolidated_research: { system: string; user_template: string };
		}>(this.name);
		const currentDate = getCurrentDateString();
		const research = await this.runLlm<{
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
		}>(
			promptCfg.consolidated_research.system
				.replace(
					"{regions}",
					researchCfg.regions.map((r: { lang: string }) => r.lang).join(", "),
				)
				.replace(
					"{angles}",
					researchCfg.angles.map((a: { name: string }) => a.name).join(", "),
				)
				.replace("{current_date}", currentDate),
			promptCfg.consolidated_research.user_template
				.replace(
					"{regions}",
					researchCfg.regions.map((r: { lang: string }) => r.lang).join(", "),
				)
				.replace("{recent_topics}", recent)
				.replace(
					"{angles}",
					researchCfg.angles.map((a: { name: string }) => a.name).join(", "),
				)
				.replace("{current_date}", currentDate),
			(t) =>
				parseLlmJson(
					t,
					z.object({
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
			{ extra: { tools: [{ googleSearchRetrieval: {} }] } },
		);
		const result: ResearchResult = {
			director_data: {
				angle: research.angle,
				title_hook: research.results[0]?.title_hook || research.selected_topic,
				search_query: research.search_query,
				key_questions: research.results
					.flatMap((r) => r.key_questions)
					.slice(0, 5),
			},
			news: research.results
				.flatMap((r) => r.news)
				.filter((n: NewsItem) => n?.title),
			memory_context: recent,
		};
		this.logOutput(result);
		return result;
	}
}
