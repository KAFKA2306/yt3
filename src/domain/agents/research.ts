import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import {
	type AssetStore,
	BaseAgent,
	fetchRecentThemes,
	getCurrentDateString,
	invokeStructuredLlm,
	type LlmOptions,
	AgentLogger as Logger,
	ROOT,
	RunStage,
} from "../../io/core.js";
import { composeResearchMemoryContext } from "../byosan/power_macro_memory.js";
import { type NewsItem, NewsItemSchema } from "../types.js";

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

export const ResearchPayloadSchema = z.object({
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
});

export type ResearchPayload = z.infer<typeof ResearchPayloadSchema>;

export type ResearchStructuredRequest = {
	schema: z.ZodSchema<ResearchPayload>;
	name: string;
	maxAttempts: number;
	evidencePath: string;
	rawResponseDir: string;
	messages: (
		attempt: number,
		lastValidationError?: string,
	) => Array<{ role: "system" | "user"; content: string }>;
};

export type ResearchStructuredInvoker = (
	request: ResearchStructuredRequest,
) => Promise<ResearchPayload>;

export function geminiResearchParams(
	request: ResearchStructuredRequest,
	opts: Record<string, unknown>,
	runDir: string,
) {
	return {
		...request,
		responseFormat: "json_text" as const,
		llmOptions: { ...opts, sessionId: runDir } as LlmOptions,
	};
}

export class TrendScout extends BaseAgent {
	private readonly invokeStructured: ResearchStructuredInvoker;

	constructor(store: AssetStore, invokeStructured?: ResearchStructuredInvoker) {
		super(store, RunStage.RESEARCH, {
			temperature: store.cfg.steps.research?.temperature || 0.5,
		});
		this.invokeStructured =
			invokeStructured ??
			((request) =>
				invokeStructuredLlm<ResearchPayload>(
					geminiResearchParams(request, this.opts, store.runDir),
				));
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
		const memoryContext = composeResearchMemoryContext(bucket, "", ROOT);
		const promptCfg = this.loadPrompt<{
			consolidated_research: {
				system: string;
				user_template: string;
			};
		}>(this.name);
		const currentDate = getCurrentDateString();
		const recentThemes = fetchRecentThemes(this.store, 7);
		let userPrompt = promptCfg.consolidated_research.user_template
			.replace(
				"{regions}",
				researchCfg.regions.map((region) => region.lang).join(", "),
			)
			.replace("{recent_topics}", memoryContext)
			.replace("{recent_themes}", recentThemes)
			.replace("{current_date}", currentDate);
		if (missionFile) {
			const sourcePath = path.isAbsolute(missionFile)
				? missionFile
				: path.join(ROOT, missionFile);
			if (!fs.existsSync(sourcePath)) {
				throw new Error(`MISSION_FILE does not exist: ${sourcePath}`);
			}
			const missionEvidence = fs.readFileSync(sourcePath, "utf8");
			userPrompt += `\n\n[MISSION EVIDENCE]\n${missionEvidence}\n(Use this supplied evidence as the primary source for the requested run. Preserve the requested JSON schema and do not add unrelated claims.)`;
			Logger.info(
				this.name,
				"RESEARCH",
				"MISSION",
				`Using explicit mission evidence: ${sourcePath}`,
			);
		}

		const systemPrompt = promptCfg.consolidated_research.system
			.replace(
				"{regions}",
				researchCfg.regions.map((region) => region.lang).join(", "),
			)
			.replace("{current_date}", currentDate);
		const payload = await this.invokeStructured({
			schema: ResearchPayloadSchema,
			name: "research_selected_topics",
			maxAttempts: 5,
			evidencePath: path.join(
				this.store.runDir,
				"research",
				"structured_attempts_initial.json",
			),
			rawResponseDir: path.join(
				this.store.runDir,
				"research",
				"raw_responses",
				"initial",
			),
			messages: (attempt, lastValidationError) => [
				{ role: "system", content: systemPrompt },
				{
					role: "user",
					content:
						lastValidationError === undefined
							? userPrompt
							: `${userPrompt}\n\n[SCHEMA VALIDATION FEEDBACK]\nattempt=${attempt}\n前回の出力は次の検証で不正でした。同じ観測条件を保ったまま、selected_topics の全要素に results 配列を含む JSON のみを返してください。\n前回の検証エラー: ${lastValidationError}`,
				},
			],
		});
		const allTopics = payload.selected_topics;
		const selectedTopic = allTopics[0];
		const selectedResult = selectedTopic?.results?.[0];
		const result: ResearchResult = {
			director_data: {
				angle: selectedResult?.angle || selectedTopic?.angle || "",
				title_hook:
					selectedResult?.title_hook || selectedTopic?.selected_topic || "",
				search_query: selectedTopic?.search_query || "",
				key_questions: allTopics
					.flatMap((topic) => topic.results)
					.flatMap((item) => item.key_questions)
					.slice(0, 5),
			},
			news: allTopics
				.flatMap((topic) => topic.results)
				.flatMap((item) => item.news)
				.filter((item) => item?.title),
			memory_context: memoryContext,
		};
		this.logOutput(result);
		return result;
	}
}
