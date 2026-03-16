import { z } from "zod";

export class GammaAPI {
	async getMarkets(): Promise<any[]> {
		const response = await fetch(
			"https://gamma-api.polymarket.com/markets?active=true&closed=false",
		);
		const data = (await response.json()) as any[];
		return data.map((m: any) => ({
			id: m.id,
			question: m.question,
			liquidity: Number.parseFloat(m.liquidity) || 0,
			volume24h: Number.parseFloat(m.volume24hr) || 0,
			spread: Number.parseFloat(m.spread) || 1,
			lastPrice: Number.parseFloat(m.lastTradePrice) || 0,
		}));
	}
}
