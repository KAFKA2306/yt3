import { z } from "zod";
import {
	type AssetStore,
	BaseAgent,
	getCurrentDateString,
	loadConfig,
	parseLlmJson,
} from "../../io/core.js";
import type { NewsItem, StrategicAnalysis } from "../types.js";
import { StrategicInsightSchema } from "../types.js";

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
