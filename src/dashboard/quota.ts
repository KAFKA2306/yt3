import { type Request, type Response, Router } from "express";
import { AgentLogger } from "../io/utils/logger.js";
import * as Ledger from "../io/utils/quota/ledger.js";
import * as QuotaManager from "../io/utils/quota/manager.js";

export function createQuotaRouter(): Router {
	const router = Router();

	router.get("/api/quota/status", (req: Request, res: Response) => {
		const keyName = (req.query.key as string) || "GEMINI_API_KEY";
		const quotas = QuotaManager.getAllEntries();
		const state = quotas.find((q: { name: string }) => q.name === keyName) as
			| { requests: number; tokens: number; reset_at: string }
			| undefined;

		if (!state) {
			res
				.status(404)
				.json({ success: false, error: `Key ${keyName} not found` });
			return;
		}

		res.json({
			success: true,
			key: keyName,
			status: "active",
			remaining: state.requests,
			remainingTokens: state.tokens,
			resetTime: state.reset_at,
			backoffLevel: 0,
		});
	});

	router.get("/api/quota/all", (req: Request, res: Response) => {
		const quotas = QuotaManager.getAllEntries();
		const keys = quotas.map(
			(q: {
				name: string;
				requests: number;
				tokens: number;
				reset_at: string;
			}) => ({
				name: q.name,
				status: "active",
				remaining: q.requests,
				remainingTokens: q.tokens,
				resetTime: q.reset_at,
				backoffLevel: 0,
			}),
		);

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
			metrics: metrics.slice(-100),
			count: metrics.length,
		});
	});

	return router;
}
