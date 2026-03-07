import { z } from "zod";
import {
	type AssetStore,
	BaseAgent,
	RunStage,
	getCurrentDateString,
	loadConfig,
	parseLlmJson,
} from "../../io/core.js";
import { NewsItemSchema } from "../types.js";

const MacroAnalysisSchema = z.object({
	summary: z.string(),
	macro_indicators: z.object({
		inflation: z.string(),
		interest_rates: z.string(),
		gdp: z.string(),
		employment: z.string(),
	}),
	outperforming_assets: z.array(z.string()),
	historical_parallels: z.array(
		z.object({
			period: z.string(),
			description: z.string(),
			outcome: z.string(),
		}),
	),
	investment_horizon: z.string(),
	unusual_correlations: z.array(
		z.object({
			assets: z.string(),
			behavior: z.string(),
			historical_significance: z.string(),
			normalization_trade_ideas: z.array(z.string()),
		}),
	),
	sources: z.array(z.string()),
});

export type MacroAnalysis = z.infer<typeof MacroAnalysisSchema>;

export class MacroRegimeAnalystAgent extends BaseAgent {
	constructor(store: AssetStore) {
		const cfg = loadConfig();
		super(store, "macro_regime_analyst", {
			temperature: cfg.steps.research?.temperature || 0.5,
		});
	}

	async run(): Promise<MacroAnalysis> {
		const cached = this.store.load<MacroAnalysis>(this.name, "output");
		if (cached) return cached;

		const p = this.loadPrompt<{ system: string; user_template: string }>(
			this.name,
		);
		const prompt = p.user_template.replace(
			"{current_date}",
			getCurrentDateString(),
		);

		const result = await this.runLlm<MacroAnalysis>(
			p.system,
			prompt,
			(t) => parseLlmJson(t, MacroAnalysisSchema),
			{ extra: { tools: [{ googleSearchRetrieval: {} }] } },
		);

		this.logOutput(result);
		return result;
	}
}
