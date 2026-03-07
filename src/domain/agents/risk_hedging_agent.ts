import { z } from "zod";
import {
	type AssetStore,
	BaseAgent,
	RunStage,
	getCurrentDateString,
	loadConfig,
	parseLlmJson,
} from "../../io/core.js";

const RiskHedgingSchema = z.object({
	hedging_strategies: z.array(
		z.object({
			instrument: z.string(),
			recommendation: z.string(),
			hedge_size_ratio: z.string(),
			annual_cost_estimate: z.string(),
			activation_triggers: z.string(),
			volatility_data_sources: z.array(z.string()),
		}),
	),
});

export type RiskHedgingAnalysis = z.infer<typeof RiskHedgingSchema>;

export class RiskHedgingAgent extends BaseAgent {
	constructor(store: AssetStore) {
		const cfg = loadConfig();
		super(store, "risk_hedging", {
			temperature: cfg.steps.research?.temperature || 0.3,
		});
	}

	async run(portfolioContext?: string): Promise<RiskHedgingAnalysis> {
		const cached = this.store.load<RiskHedgingAnalysis>(this.name, "output");
		if (cached) return cached;

		const p = this.loadPrompt<{ system: string; user_template: string }>(
			this.name,
		);
		const prompt = p.user_template
			.replace(
				"{portfolio_context}",
				portfolioContext ||
					"米国株およびテックセクターに重点を置いた分散ポートフォリオ",
			)
			.replace("{current_date}", getCurrentDateString());

		const result = await this.runLlm<RiskHedgingAnalysis>(
			p.system,
			prompt,
			(t) => parseLlmJson(t, RiskHedgingSchema),
			{ extra: { tools: [{ googleSearchRetrieval: {} }] } },
		);

		this.logOutput(result);
		return result;
	}
}
