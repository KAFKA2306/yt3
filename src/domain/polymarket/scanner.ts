import { z } from "zod";

export const MarketSchema = z.object({
	id: z.string(),
	question: z.string(),
	liquidity: z.number(),
	volume24h: z.number(),
	spread: z.number(),
	lastPrice: z.number(),
});

export type Market = z.infer<typeof MarketSchema>;

export class Scanner {
	filterMarkets(
		markets: Market[],
		minLiquidity: number,
		minVolume: number,
		maxSpread: number,
	): Market[] {
		return markets.filter(
			(m) =>
				m.liquidity >= minLiquidity &&
				m.volume24h >= minVolume &&
				m.spread <= maxSpread,
		);
	}
}
