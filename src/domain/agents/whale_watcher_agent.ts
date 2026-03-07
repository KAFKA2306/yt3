import { z } from "zod";
import {
	type AssetStore,
	BaseAgent,
	RunStage,
	getCurrentDateString,
	loadConfig,
	parseLlmJson,
} from "../../io/core.js";

const WhaleWatcherSchema = z.object({
	institutional_moves: z.array(
		z.object({
			fund_name: z.string(),
			newly_purchased: z.array(z.string()),
			completely_sold: z.array(z.string()),
			increased_positions: z.array(z.string()),
			analysis: z.string(),
			sources: z.array(z.string()),
		}),
	),
});

export type WhaleWatcherAnalysis = z.infer<typeof WhaleWatcherSchema>;

export class WhaleWatcherAgent extends BaseAgent {
	constructor(store: AssetStore) {
		const cfg = loadConfig();
		super(store, "whale_watcher", {
			temperature: cfg.steps.research?.temperature || 0.4,
		});
	}

	async run(): Promise<WhaleWatcherAnalysis> {
		const cached = this.store.load<WhaleWatcherAnalysis>(this.name, "output");
		if (cached) return cached;

		const p = this.loadPrompt<{ system: string; user_template: string }>(
			this.name,
		);
		const prompt = p.user_template.replace(
			"{current_date}",
			getCurrentDateString(),
		);

		const result = await this.runLlm<WhaleWatcherAnalysis>(
			p.system,
			prompt,
			(t) => parseLlmJson(t, WhaleWatcherSchema),
			{ extra: { tools: [{ googleSearchRetrieval: {} }] } },
		);

		this.logOutput(result);
		return result;
	}
}
