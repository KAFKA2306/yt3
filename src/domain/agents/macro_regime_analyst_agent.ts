import { z } from "zod";
import {
	type AssetStore,
	BaseAgent,
	getCurrentDateString,
	loadConfig,
	parseLlmJson,
} from "../../io/core.js";
import type { NewsItem } from "../types.js";

/**
 * Chief Investment Strategist (formerly Macro Analyst)
 * Robust Schema with Preprocessing to handle LLM structure variations.
 */

const ensureArray = (val: unknown) => (Array.isArray(val) ? val : [val]);

const StrategicInsightSchema = z.object({
	primary_delta: z.object({
		event: z.string(),
		magnitude: z.string(),
		structural_shift: z.string(),
	}),
	insights: z.preprocess(
		ensureArray,
		z.array(
			z.object({
				observation: z.string(),
				implication: z.string(),
				wisdom: z.string(),
			}),
		),
	),
	investment_ideas: z.preprocess(
		ensureArray,
		z.array(
			z.object({
				asset: z.string(),
				rationale: z.string(),
			}),
		),
	),
	strategic_summary: z.string(),
	sources: z.array(z.string()),
});

export type StrategicAnalysis = z.infer<typeof StrategicInsightSchema>;

export class MacroRegimeAnalystAgent extends BaseAgent {
	constructor(store: AssetStore) {
		const cfg = loadConfig();
		super(store, "macro_regime_analyst", {
			temperature: cfg.steps.research?.temperature || 0.7,
		});
	}

	async run(news: NewsItem[] = []): Promise<StrategicAnalysis> {
		const cached = this.store.load<StrategicAnalysis>(this.name, "output");
		if (cached) return cached;

		const p = this.loadPrompt<{ system: string; user_template: string }>(
			this.name,
		);

		const newsContext =
			news.length > 0
				? news
						.map((n) => `Title: ${n.title}\nSummary: ${n.summary}`)
						.join("\n\n")
				: "（データ取得中）";

		const prompt = p.user_template
			.replace("{current_date}", getCurrentDateString())
			.replace("{news_context}", newsContext);

		const result = await this.runLlm<StrategicAnalysis>(
			p.system,
			prompt,
			(t) => parseLlmJson(t, StrategicInsightSchema),
			{ extra: { tools: [{ googleSearchRetrieval: {} }] } },
		);

		this.logOutput(result);
		return result;
	}
}
