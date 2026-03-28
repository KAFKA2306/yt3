import { z } from "zod";
import type { AssetStore } from "../../io/core.js";
import { BaseAgent } from "../../io/core.js";
import { AgentLogger } from "../../io/utils/logger.js";
import type { FinancialFinding } from "../types.js";

export class DexterJPAgent extends BaseAgent {
	constructor(store: AssetStore) {
		super(store, "dexter_jp", { temperature: 0.5 });
	}

	async run(query: string, limit = 3): Promise<FinancialFinding[]> {
		this.logInput({ query, limit });

		AgentLogger.info(
			this.name,
			"ANALYSIS",
			"START",
			`Analyzing financial data for: ${query}`,
		);

		const apiKey =
			process.env.OPENAI_API_KEY ||
			process.env.ANTHROPIC_API_KEY ||
			"";

		if (!apiKey) {
			AgentLogger.warn(
				this.name,
				"ANALYSIS",
				"SKIP",
				"No LLM API key available",
			);
			return [];
		}

		try {
			const findings = await this.analyzeFinancialTheme(query);

			AgentLogger.info(
				this.name,
				"ANALYSIS",
				"SUCCESS",
				`Generated ${findings.length} financial findings`,
			);

			this.logOutput({ findings_count: findings.length });
			return findings.slice(0, limit);
		} catch (error) {
			AgentLogger.warn(
				this.name,
				"ANALYSIS",
				"ERROR",
				`Financial analysis failed: ${error}`,
			);
			return [];
		}
	}

	private async analyzeFinancialTheme(
		query: string,
	): Promise<FinancialFinding[]> {
		const llmApiKey = process.env.OPENAI_API_KEY;
		if (!llmApiKey) return [];

		try {
			const response = await fetch(
				"https://api.openai.com/v1/chat/completions",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${llmApiKey}`,
					},
					body: JSON.stringify({
						model: "gpt-4o-mini",
						messages: [
							{
								role: "system",
								content: `You are a financial analyst specializing in Japanese stock market and EDINET data. Analyze the given query and provide structured financial insights related to relevant Japanese companies. Return as JSON array:
[{"company": "Company Name", "edinet_key_metrics": {"metric": "value"}, "jquants_data": {"data": "value"}, "summary": "analysis"}]`,
							},
							{
								role: "user",
								content: `Analyze this financial research theme: "${query}". Provide key financial findings for relevant Japanese companies including EDINET metrics and J-Quants data points.`,
							},
						],
						temperature: 0.3,
					}),
				},
			);

			if (!response.ok) {
				throw new Error(`LLM API error: ${response.statusText}`);
			}

			const data = (await response.json()) as Record<string, unknown>;
			const choices = data.choices as unknown[];
			const firstChoice = choices?.[0] as Record<string, unknown>;
			const message = firstChoice?.message as Record<string, unknown>;
			const content = String(message?.content || "[]");

			// Extract JSON from response
			const jsonMatch = content.match(/\[[\s\S]*\]/);
			const parsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as unknown[]) : [];

			return parsed.map((item: unknown) => {
				const obj = item as Record<string, unknown>;
				return {
					company: obj.company ? String(obj.company) : undefined,
					edinet_key_metrics: this.ensureRecord(obj.edinet_key_metrics),
					jquants_data: this.ensureRecord(obj.jquants_data),
					summary: String(obj.summary || ""),
				};
			});
		} catch (error) {
			AgentLogger.warn(
				this.name,
				"ANALYSIS",
				"PARSE_ERROR",
				`Failed to parse financial analysis: ${error}`,
			);
			return [];
		}
	}

	private ensureRecord(
		obj: unknown,
	): Record<string, string> | undefined {
		if (obj && typeof obj === "object" && !Array.isArray(obj)) {
			return Object.fromEntries(
				Object.entries(obj).map(([k, v]) => [
					k,
					String(v || ""),
				]),
			);
		}
		return undefined;
	}
}
