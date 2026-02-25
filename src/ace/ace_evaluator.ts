import fs from "fs-extra";
import { z } from "zod";
import { AgentLogger as Logger, createLlm, parseLlmJson } from "../core.js";
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
		const llm = createLlm({
			temperature: 0,
			response_mime_type: "application/json",
		});
		const systemPrompt = `Your response MUST be a valid JSON array of objects.
Do not include any other text before or after the JSON.
You are the ACE Evaluator (Reflector).
Analyze the provided agent logs and determine if the specific ACE Bullets (strategic instructions) were successful or if they caused issues.
Output a JSON array of EvaluationSignal objects.
EvaluationSignal Schema:
[
  {
    "bullet_id": "string",
    "success": boolean,
    "reason": "string explaining the success or failure",
    "weight": number (0.0 to 1.0, impact of this signal)
  }
]`;
		const userPrompt = `ACE Bullets being evaluated:
${bulletIds.join(", ")}
Agent Logs:
${JSON.stringify(recentLogs, null, 2)}
Provide evaluation signals for the bullets mentioned or implied in the logs.`;
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
}
