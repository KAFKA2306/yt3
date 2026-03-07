import { z } from "zod";
import {
	type AssetStore,
	BaseAgent,
	RunStage,
	getCurrentDateString,
	loadConfig,
	parseLlmJson,
} from "../../io/core.js";

const EventAnalysisSchema = z.object({
	short_squeeze_candidates: z.array(
		z.object({
			ticker: z.string(),
			short_interest_ratio: z.string(),
			days_to_cover: z.string(),
			catalyst: z.string(),
			entry_strategy: z.string(),
			risks: z.string(),
			sources: z.array(z.string()),
		}),
	),
	ma_candidates: z.array(
		z.object({
			ticker: z.string(),
			acquirer_rumor: z.string(),
			rationale: z.string(),
			historical_premiums: z.string(),
			regulatory_risks: z.string(),
			sources: z.array(z.string()),
		}),
	),
});

export type EventAnalysis = z.infer<typeof EventAnalysisSchema>;

export class EventDrivenAnalystAgent extends BaseAgent {
	constructor(store: AssetStore) {
		const cfg = loadConfig();
		super(store, "event_driven_analyst", {
			temperature: cfg.steps.research?.temperature || 0.4,
		});
	}

	async run(): Promise<EventAnalysis> {
		const cached = this.store.load<EventAnalysis>(this.name, "output");
		if (cached) return cached;

		const p = this.loadPrompt<{ system: string; user_template: string }>(
			this.name,
		);
		const prompt = p.user_template.replace(
			"{current_date}",
			getCurrentDateString(),
		);

		const result = await this.runLlm<EventAnalysis>(
			p.system,
			prompt,
			(t) => parseLlmJson(t, EventAnalysisSchema),
			{ extra: { tools: [{ googleSearchRetrieval: {} }] } },
		);

		this.logOutput(result);
		return result;
	}
}
