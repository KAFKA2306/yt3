import { z } from "zod";
import type { AssetStore } from "../../io/core.js";
import { BaseAgent } from "../../io/core.js";
import { AgentLogger } from "../../io/utils/logger.js";
import type { WebSearchResult } from "../types.js";

export class WebSearchAgent extends BaseAgent {
	constructor(store: AssetStore) {
		super(store, "web_search", { temperature: 0.7 });
	}

	async run(query: string, limit = 5): Promise<WebSearchResult[]> {
		this.logInput({ query, limit });

		AgentLogger.info(
			this.name,
			"SEARCH",
			"START",
			`Searching web for: ${query}`,
		);

		const apiKey =
			process.env.PERPLEXITY_API_KEY ||
			process.env.OPENAI_API_KEY ||
			"";

		if (!apiKey) {
			AgentLogger.warn(
				this.name,
				"SEARCH",
				"SKIP",
				"No API key available for web search",
			);
			return [];
		}

		try {
			const response = await fetch("https://api.perplexity.ai/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					model: "pplx-7b-online",
					messages: [
						{
							role: "user",
							content: `Search the web and find the top ${limit} results related to: "${query}". Return as JSON array with: [{"title": "", "url": "", "snippet": "", "source": ""}]`,
						},
					],
					temperature: 0.3,
				}),
			});

			if (!response.ok) {
				throw new Error(
					`Perplexity API error: ${response.statusText}`,
				);
			}

			const data = (await response.json()) as Record<string, unknown>;
			const choices = data.choices as unknown[];
			const firstChoice = choices?.[0] as Record<string, unknown>;
			const message = firstChoice?.message as Record<string, unknown>;
			const content = String(message?.content || "[]");

			// Extract JSON from response
			const jsonMatch = content.match(/\[[\s\S]*\]/);
			const results = jsonMatch
				? (JSON.parse(jsonMatch[0]) as unknown[])
				: [];

			const validated = results
				.slice(0, limit)
				.map((item: unknown) => {
					const obj = item as Record<string, unknown>;
					return {
						title: String(obj.title || ""),
						url: String(obj.url || ""),
						snippet: String(obj.snippet || ""),
						source: obj.source ? String(obj.source) : "web",
					};
				});

			AgentLogger.info(
				this.name,
				"SEARCH",
				"SUCCESS",
				`Found ${validated.length} results`,
			);

			this.logOutput({ results_count: validated.length });
			return validated;
		} catch (error) {
			AgentLogger.warn(
				this.name,
				"SEARCH",
				"ERROR",
				`Web search failed: ${error}`,
			);
			return [];
		}
	}
}
