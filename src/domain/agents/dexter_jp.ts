import { z } from "zod";
import { type AssetStore, BaseAgent, parseLlmJson } from "../../io/core.js";
import { AgentLogger } from "../../io/utils/logger.js";
import { type FinancialFinding, NewsItemSchema } from "../types.js";

const DexterResponseSchema = z.array(
	z.object({
		company: z.string().optional(),
		edinet_key_metrics: z.record(z.string(), z.string()).optional(),
		jquants_data: z.record(z.string(), z.string()).optional(),
		summary: z.string(),
	}),
);

export class DexterJPAgent extends BaseAgent {
	constructor(store: AssetStore) {
		super(store, "dexter_jp", { temperature: 0.3 });
	}

	async run(query: string, limit = 3): Promise<FinancialFinding[]> {
		this.logInput({ query, limit });

		AgentLogger.info(
			this.name,
			"ANALYSIS",
			"START",
			`Analyzing financial data for: ${query}`,
		);

		const systemPrompt = `You are a financial analyst specializing in Japanese stock market and EDINET data. Analyze the given query and provide structured financial insights related to relevant Japanese companies. Return ONLY a JSON array.
[{"company": "Company Name", "edinet_key_metrics": {"metric": "value"}, "jquants_data": {"data": "value"}, "summary": "analysis"}]`;

		const userPrompt = `Analyze this financial research theme: "${query}". Provide key financial findings for relevant Japanese companies including EDINET metrics and J-Quants data points.`;

		const findings = await this.runLlm<FinancialFinding[]>(
			systemPrompt,
			userPrompt,
			(t) => parseLlmJson(t, DexterResponseSchema),
		);

		AgentLogger.info(
			this.name,
			"ANALYSIS",
			"SUCCESS",
			`Generated ${findings.length} financial findings`,
		);

		this.logOutput({ findings_count: findings.length });
		return findings.slice(0, limit);
	}
}
