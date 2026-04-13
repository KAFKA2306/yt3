import { z } from "zod";

export class GammaAPI {
	async getMarkets(): Promise<unknown[]> {
		const response = await fetch(
			"https://gamma-api.polymarket.com/markets?active=true&closed=false",
		);
		const data = (await response.json()) as unknown[];
		return data.map((item: unknown) => {
			const m = item as Record<string, unknown>;
			return {
				id: m.id,
				question: m.question,
				liquidity: Number.parseFloat(String(m.liquidity)) || 0,
				volume24h: Number.parseFloat(String(m.volume24hr)) || 0,
				spread: Number.parseFloat(String(m.spread)) || 1,
				lastPrice: Number.parseFloat(String(m.lastTradePrice)) || 0,
			};
		});
	}
}
