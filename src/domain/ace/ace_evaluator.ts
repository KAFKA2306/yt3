import fs from "fs-extra";
import { z } from "zod";
import {
	AgentLogger as Logger,
	createLlm,
	parseLlmJson,
} from "../../io/core.ts";
import { type EvaluationSignal, EvaluationSignalSchema } from "./types.js";
export class AceEvaluator {
	async evaluateLatestLogs(
		logPath: string,
		bulletIds: string[],
	): Promise<EvaluationSignal[]> {
		if (!fs.existsSync(logPath)) {
			Logger.warn(
				"AceEvaluator",
				"EVAL",
				"MISSING_LOGS",
				`Log file not found at ${logPath}`,
			);
			return [];
		}
		const logs = fs
			.readFileSync(logPath, "utf-8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		const recentLogs = logs.slice(-50);
		Logger.info(
			"AceEvaluator",
			"EVAL",
			"START",
			`Analyzing ${recentLogs.length} log entries for ${bulletIds.length} bullets`,
		);

		// --- Mathematical Objectification (Internal Metrics) ---
		const repetitionScore = this.calculateRepetitionScore(recentLogs);
		const sensationalismScore = this.calculateSensationalismScore(recentLogs);

		Logger.info(
			"AceEvaluator",
			"EVAL",
			"METRICS",
			`Repetition: ${repetitionScore.toFixed(2)}, Sensationalism: ${sensationalismScore.toFixed(2)}`,
		);
		const llm = createLlm({
			temperature: 0,
			response_mime_type: "application/json",
		});
		const systemPrompt = `Your response MUST be a valid JSON array of objects.
Do not include any other text before or after the JSON.
You are the ACE Evaluator (Objective Auditor).
Analyze the provided agent logs and determine if the specific ACE Bullets (strategic instructions) successfully prioritized hard facts and numerical deltas.

**【SOFT METRIC EVALUATION】**
Evaluate the overall quality against these "Objective Metrics":
1. **Fact Fidelity**: Does the content prioritize hard numbers (%, $, quantities) and specific actors over adjectives?
2. **Impact Magnitude**: Was the chosen topic the one with the largest verifiable numerical delta in the logs?
3. **Sensationalism Check**: Does the 'title_hook' or 'thumbnail_title' use prohibited clickbait (e.g., "Emergency", "Collapse", "The End")?

Output a JSON array of EvaluationSignal objects.
EvaluationSignal Schema:
[
  {
    "bullet_id": "string",
    "success": boolean,
    "reason": "Explain how the data-driven mandates were met or failed",
    "weight": number (0.0 to 1.0)
  }
]`;
		const userPrompt = `ACE Bullets being evaluated:
${bulletIds.join(", ")}
Agent Logs:
${JSON.stringify(recentLogs, null, 2)}

**【MATHEMATICAL METRICS (Internal)】**
- Repetition Score (Jaccard): ${repetitionScore.toFixed(2)} (0.0=Original, 1.0=Duplicate)
- Sensationalism Score: ${sensationalismScore.toFixed(2)} (0.0=Grounded, 1.0=Hype)

Provide evaluation signals for the bullets mentioned or implied in the logs.
Include 'soft-metric-repetition' and 'soft-metric-sensationalism' if metrics are high/low enough.`;
		const response = await llm.invoke([
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userPrompt },
		]);
		const signals = parseLlmJson(
			response.content as string,
			z.array(EvaluationSignalSchema),
		);
		Logger.info(
			"AceEvaluator",
			"EVAL",
			"DONE",
			`Generated ${signals.length} evaluation signals`,
		);
		return signals;
	}

	private calculateRepetitionScore(logs: Record<string, unknown>[]): number {
		const topics = logs
			.filter(
				(l) =>
					l.event === "TOPIC_SELECTED" ||
					(l.payload &&
						typeof l.payload === "object" &&
						"selected_topic" in l.payload),
			)
			.map((l) => {
				const payload = l.payload as Record<string, unknown> | undefined;
				return (payload?.selected_topic as string) || (l.message as string);
			});
		if (topics.length < 2) return 0;

		// Improved similarity for Japanese (character-based if no spaces)
		const tokenize = (text: string) => {
			if (text.includes(" ")) return text.split(" ");
			// Character-level n-grams (bigram) for better Japanese comparison
			const chars = text.split("");
			let biGrams: string[] = [];
			for (let i = 0; i < chars.length - 1; i++) {
				const c1 = chars[i];
				const c2 = chars[i + 1];
				if (c1 !== undefined && c2 !== undefined) {
					biGrams = [...biGrams, c1 + c2];
				}
			}
			return biGrams.length > 0 ? biGrams : chars;
		};

		const setA = new Set(tokenize(topics[0] || ""));
		const setB = new Set(tokenize(topics[topics.length - 1] || ""));
		const intersection = new Set([...setA].filter((x) => setB.has(x)));
		const union = new Set([...setA, ...setB]);
		return intersection.size / union.size;
	}

	private calculateSensationalismScore(
		logs: Record<string, unknown>[],
	): number {
		const texts = JSON.stringify(logs).toLowerCase();
		const ngWords = [
			"emergency",
			"collapse",
			"end of japan",
			"shock",
			"catastrophe",
			"warning",
			"緊急",
			"崩壊",
			"日本終了",
			"衝撃",
			"破滅",
			"警告",
			"ヤバい",
			"最悪",
		];
		let count = 0;
		for (const word of ngWords) {
			if (texts.includes(word)) count++;
		}
		return Math.min(1.0, count / 3);
	}
}
