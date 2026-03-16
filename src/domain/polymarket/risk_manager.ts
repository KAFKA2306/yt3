import { z } from "zod";

export const RiskConfigSchema = z.object({
	alpha: z.number().default(0.25),
	maxExposure: z.number(),
	dailyVaRLimit: z.number(),
	maxDrawdownLimit: z.number().default(0.08),
	minEdge: z.number().default(0.04),
});

export type RiskConfig = z.infer<typeof RiskConfigSchema>;

export class RiskManager {
	constructor(private config: RiskConfig) {}

	calculateKelly(pModel: number, decimalOdds: number): number {
		const b = decimalOdds - 1;
		const fStar = (pModel * b - (1 - pModel)) / b;
		return Math.max(0, fStar * this.config.alpha);
	}

	calculateVaR(mu: number, sigma: number, confidence = 0.95): number {
		const zScore = confidence === 0.95 ? 1.645 : 2.326;
		return mu - zScore * sigma;
	}

	checkTrade(
		edge: number,
		size: number,
		currentExposure: number,
		currentMDD: number,
		vaR: number,
	): boolean {
		if (edge < this.config.minEdge) return false;
		if (currentExposure + size > this.config.maxExposure) return false;
		if (currentMDD > this.config.maxDrawdownLimit) return false;
		if (Math.abs(vaR) > this.config.dailyVaRLimit) return false;
		return true;
	}
}
