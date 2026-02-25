import path from "node:path";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
	AgentLogger as Logger,
	ROOT,
	createLlm,
	parseLlmJson,
} from "../core.js";
import { ContextPlaybook } from "./context_playbook.js";
import { type Hypothesis, HypothesisSchema } from "./types.js";
export class AceAcquirer {
	async acquireNewHypotheses(): Promise<Hypothesis[]> {
		const memoryIndexPath = path.join(ROOT, "data", "memory", "index.json");
		let recentTopics: string[] = [];
		if (fs.existsSync(memoryIndexPath)) {
			const index = fs.readJsonSync(memoryIndexPath) as {
				videos: Array<{ topic: string }>;
			};
			recentTopics = index.videos.slice(-5).map((v) => v.topic);
		}
		Logger.info(
			"AceAcquirer",
			"ACQUIRE",
			"START",
			`Generating new hypotheses based on ${recentTopics.length} recent topics`,
		);
		const llm = createLlm({
			temperature: 0.2,
			response_mime_type: "application/json",
		});
		const systemPrompt = `Your response MUST be a valid JSON array of objects.
Do not include any other text before or after the JSON.
You are the AceAcquirer (StrategyMiner).
Your job is to generate "Orthogonal Hypotheses" - new strategic instructions or rules for an AI YouTuber agent that are DIFFERENT from current approaches.
Current approaches focus on high-quality financial analysis and specific characters (Kasukabe Tsumugi, Zundamon).
Hypothesis Schema:
[
  {
    "content": "A clear, actionable strategic instruction (bullet).",
    "rationale": "Why this might improve video performance or quality.",
    "category": "Optional category (e.g., 'Retention', 'Emotion', 'Visual')"
  }
]`;
		const userPrompt = `Recent video topics produced:
${recentTopics.join("\n")}
Suggest 3 new, orthogonal strategic hypotheses that could improve the "Alpha" of the generated content.
Focus on areas like viewer retention, emotional hooks, or structural surprises that are not currently being used.`;
		const response = await llm.invoke([
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userPrompt },
		]);
		const hypotheses = parseLlmJson(
			response.content as string,
			z.array(HypothesisSchema),
		);
		Logger.info(
			"AceAcquirer",
			"ACQUIRE",
			"DONE",
			`Generated ${hypotheses.length} new hypotheses`,
		);
		return hypotheses;
	}
	async commitHypothesesToPlaybook(hypotheses: Hypothesis[]) {
		const playbook = new ContextPlaybook();
		for (const h of hypotheses) {
			playbook.addBullet({
				id: uuidv4(),
				content: h.content,
				source: "Acquisition",
				confidence: 0.5,
				runs: 0,
				successes: 0,
				category: h.category,
			});
		}
	}
}
