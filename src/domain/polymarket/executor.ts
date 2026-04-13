export class Executor {
	async executeOrder(
		marketId: string,
		side: "BUY" | "SELL",
		size: number,
		price: number,
	): Promise<{ orderId: string; status: string }> {
		console.log(`Executing ${side} order on ${marketId}: ${size} @ ${price}`);
		return { orderId: "mock_order_id", status: "FILLED" };
	}
}
