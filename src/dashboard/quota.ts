import { Router, type Request, type Response } from "express";
import { QuotaManager } from "../io/utils/quota_manager.js";
import { AgentLogger } from "../io/utils/logger.js";

export function createQuotaRouter(): Router {
	const router = Router();

	router.get("/api/quota/status", (req: Request, res: Response) => {
		const keyName = (req.query.key as string) || "GEMINI_API_KEY";
		const ledger = QuotaManager.getLedgerSnapshot();
		const state = ledger.keys[keyName];

		if (!state) {
			res.status(404).json({
				success: false,
				error: `Key ${keyName} not found`,
			});
			return;
		}

		const requestPercent = (state.remaining / 15) * 100;
		const tokenPercent = (state.remainingTokens / 1000000) * 100;

		res.json({
			success: true,
			key: keyName,
			status: state.status,
			remaining: state.remaining,
			remainingTokens: state.remainingTokens,
			resetTime: state.resetTime,
			backoffLevel: state.backoffLevel,
			requestPercent: Math.round(requestPercent),
			tokenPercent: Math.round(tokenPercent),
			isLowQuota: requestPercent < 30 || tokenPercent < 30,
		});
	});

	router.get("/api/quota/all", (req: Request, res: Response) => {
		const ledger = QuotaManager.getLedgerSnapshot();
		const keys = Object.entries(ledger.keys).map(([name, state]) => {
			const requestPercent = (state.remaining / 15) * 100;
			const tokenPercent = (state.remainingTokens / 1000000) * 100;

			return {
				name,
				status: state.status,
				remaining: state.remaining,
				remainingTokens: state.remainingTokens,
				resetTime: state.resetTime,
				backoffLevel: state.backoffLevel,
				requestPercent: Math.round(requestPercent),
				tokenPercent: Math.round(tokenPercent),
				isLowQuota: requestPercent < 30 || tokenPercent < 30,
			};
		});

		res.json({
			success: true,
			keys,
			totalKeys: keys.length,
			timestamp: new Date().toISOString(),
		});
	});

	router.post("/api/quota/rotate", (req: Request, res: Response) => {
		const sessionId = (req.body.sessionId as string) || "manual";

		try {
			const selected = QuotaManager.acquireKey(sessionId);
			res.json({
				success: true,
				message: "Key rotated successfully",
				key: selected.name,
				index: selected.index,
			});
		} catch (err) {
			AgentLogger.error(
				"DASHBOARD",
				"QUOTA",
				"ROTATE",
				err instanceof Error ? err.message : String(err),
			);
			res.status(503).json({
				success: false,
				error: err instanceof Error ? err.message : "Failed to rotate key",
			});
		}
	});

	router.get("/api/quota/metrics", (req: Request, res: Response) => {
		const metrics = QuotaManager.getMetrics();

		res.json({
			success: true,
			metrics: metrics.slice(-100), // Last 100 metrics
			count: metrics.length,
		});
	});

	return router;
}
