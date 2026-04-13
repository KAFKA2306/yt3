import { AgentLogger as Logger } from "../logger.js";
import * as Ledger from "./ledger.js";
import { recordQuotaMetric } from "./metrics.js";
import {
	QuotaExhaustionError,
	type QuotaLedger,
	type QuotaMetric,
} from "./types.js";

const THRESHOLD = 0.3;

export async function waitIfRateLimited(keyName: string): Promise<number> {
	return 0;
}

export function acquireKey(sessionId?: string) {
	const k = process.env.GEMINI_API_KEY || process.env.X_API_KEY;
	if (!k) throw new QuotaExhaustionError("No API keys available.");
	return { name: "GEMINI_API_KEY", key: k, index: 1 };
}

export function updateFromHeaders(
	key: string,
	headers: Record<string, unknown>,
) {}

export function getQuotaContext(key: string, provider: string): string {
	if (provider === "local") return "LOCAL";
	return `GEMINI_${key}`;
}

export function getAllEntries() {
	return Ledger.getQuotas();
}

export function getMetrics() {
	return [];
}

export { QuotaExhaustionError };
