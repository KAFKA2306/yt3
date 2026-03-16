import { z } from "zod";

export const PredictionResultSchema = z.object({
	p_model: z.number(),
	confidence: z.number(),
	rational: z.string(),
});

export type PredictionResult = z.infer<typeof PredictionResultSchema>;

export class Predictor {
	calculateTrueProbability(
		marketPrice: number,
		sentimentScore: number,
		newsDelta: number,
	): PredictionResult {
		// p_model = mkt_price + adjustments
		const p_model = marketPrice + sentimentScore + newsDelta;
		const clampedP = Math.max(0.01, Math.min(0.99, p_model));

		return {
			p_model: clampedP,
			confidence: 0.85,
			rational: `Model probability ${clampedP.toFixed(2)} (Market: ${marketPrice.toFixed(2)}, Sentiment Adjustment: ${sentimentScore.toFixed(2)})`,
		};
	}
}
