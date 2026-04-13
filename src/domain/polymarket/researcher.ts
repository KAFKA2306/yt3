import { z } from "zod";
import { createLlm, parseLlmJson } from "../../io/core";

export class ResearchEngine {
	async analyzeSentiment(question: string): Promise<number> {
		const llm = createLlm({ temperature: 0.1 });
		const prompt = `Analyze the sentiment and realistic probability for the following prediction market question: "${question}". 
        Return a JSON object with a "score" between -0.5 (very negative/unlikely) and 0.5 (very positive/likely).
        
        JSON: { "score": number, "rationale": string }`;

		const response = await llm.invoke(prompt);
		const result = parseLlmJson(
			response.content as string,
			z.object({ score: z.number() }),
		);
		return result.score;
	}

	async extractNarrative(socialData: string[]): Promise<string> {
		return socialData.join(" | ");
	}
}
