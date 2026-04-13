import {
	AgentLogger,
	BaseAgent,
	RunStage,
	parseLlmJson,
} from "../../io/core.js";
import type { AssetStore } from "../../io/core.js";

export class TranslatorAgent extends BaseAgent {
	constructor(store: AssetStore) {
		super(store, "translator", { temperature: 0.3 });
	}

	async translateTitle(englishTitle: string): Promise<string> {
		const systemPrompt = `You are an expert financial translator. Translate the following English video title to an engaging, professional Japanese title for a financial YouTube channel.
        Return ONLY a JSON object: {"japanese_title": "..."}`;

		const userPrompt = `Title: "${englishTitle}"`;

		try {
			return await this.runLlm(systemPrompt, userPrompt, (text) => {
				const parsed = parseLlmJson<{ japanese_title: string }>(text);
				return parsed.japanese_title;
			});
		} catch (error) {
			AgentLogger.error(
				this.name,
				"TRANSLATE",
				"ERROR",
				`Translation failed: ${error}`,
			);
			return englishTitle; // Fallback
		}
	}
}
