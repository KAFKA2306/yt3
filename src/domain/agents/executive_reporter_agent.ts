import { z } from "zod";
import {
	type AssetStore,
	BaseAgent,
	RunStage,
	getCurrentDateString,
	loadConfig,
	parseLlmJson,
} from "../../io/core.js";

const WeeklyReportSchema = z.object({
	executive_briefing: z.object({
		macro_events: z.array(z.string()),
		earnings_focus: z.array(z.string()),
		sector_flows: z.array(z.string()),
		trade_ideas: z.object({
			long: z.string(),
			short: z.string(),
		}),
		risk_on_radar: z.array(z.string()),
		sources: z.array(z.string()),
	}),
});

export type WeeklyReport = z.infer<typeof WeeklyReportSchema>;

export class ExecutiveReporterAgent extends BaseAgent {
	constructor(store: AssetStore) {
		const cfg = loadConfig();
		super(store, RunStage.RESEARCH, {
			temperature: cfg.steps.research?.temperature || 0.3,
		});
	}

	async run(analystOutputs: Record<string, unknown>): Promise<WeeklyReport> {
		const cached = this.store.load<WeeklyReport>(this.name, "output");
		if (cached) return cached;

		const p = this.loadPrompt<{ system: string; user_template: string }>(
			this.name,
		);
		const prompt = p.user_template
			.replace("{analyst_outputs}", JSON.stringify(analystOutputs, null, 2))
			.replace("{current_date}", getCurrentDateString());

		const result = await this.runLlm<WeeklyReport>(
			p.system,
			prompt,
			(t) => parseLlmJson(t, WeeklyReportSchema),
			{ extra: { tools: [{ googleSearchRetrieval: {} }] } },
		);

		this.logOutput(result);
		return result;
	}
}
