import { z } from "zod";
import {
	type AssetStore,
	BaseAgent,
	RunStage,
	getCurrentDateString,
	loadConfig,
	parseLlmJson,
} from "../../io/core.js";

const FundamentalAuditSchema = z.object({
	sentiment_vs_fundamental_distortions: z.array(
		z.object({
			ticker: z.string(),
			negative_sentiment_reason: z.string(),
			fundamental_conflict_reason: z.string(),
			technical_entry_levels: z.string(),
			sources: z.array(z.string()),
		}),
	),
	dividend_risk_radar: z.array(
		z.object({
			ticker: z.string(),
			current_yield: z.string(),
			dividend_cut_probability: z.string(),
			risk_factors: z.array(z.string()),
			safer_alternatives: z.array(z.string()),
			sources: z.array(z.string()),
		}),
	),
});

export type FundamentalAudit = z.infer<typeof FundamentalAuditSchema>;

export class FundamentalAuditAgent extends BaseAgent {
	constructor(store: AssetStore) {
		const cfg = loadConfig();
		super(store, "fundamental_audit", {
			temperature: cfg.steps.research?.temperature || 0.4,
		});
	}

	async run(): Promise<FundamentalAudit> {
		const cached = this.store.load<FundamentalAudit>(this.name, "output");
		if (cached) return cached;

		const p = this.loadPrompt<{ system: string; user_template: string }>(
			this.name,
		);
		const prompt = p.user_template.replace(
			"{current_date}",
			getCurrentDateString(),
		);

		const result = await this.runLlm<FundamentalAudit>(
			p.system,
			prompt,
			(t) => parseLlmJson(t, FundamentalAuditSchema),
			{ extra: { tools: [{ googleSearchRetrieval: {} }] } },
		);

		this.logOutput(result);
		return result;
	}
}
