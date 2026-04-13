export class LearningLoop {
	recordTrade(tradeData: unknown, outcome: "WIN" | "LOSS"): void {
		if (outcome === "LOSS") {
			console.log(`Analyzing loss: ${JSON.stringify(tradeData)}`);
		}
	}

	calculateBrierScore(p: number, o: number): number {
		return (p - o) ** 2;
	}
}
