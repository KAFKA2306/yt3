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
	const keyList = [
		{ name: "GEMINI_API_KEY", env: "GEMINI_API_KEY" },
		{ name: "GEMINI_API_KEY_2", env: "GEMINI_API_KEY_2" },
		{ name: "GEMINI_API_KEY_3", env: "GEMINI_API_KEY_3" },
		{ name: "GEMINI_API_KEY_4", env: "GEMINI_API_KEY_4" },
		{ name: "GEMINI_API_KEY_5", env: "GEMINI_API_KEY_5" },
	];

	for (let i = 0; i < keyList.length; i++) {
		const item = keyList[i];
		if (!item) continue;
		const val = process.env[item.env];
		if (!val) continue;

		const quota = Ledger.getQuota(item.name);
		const resetDate = new Date(quota.reset_at).toDateString();
		const nowDate = new Date().toDateString();
		if (resetDate !== nowDate) {
			quota.requests = 0;
			quota.tokens = 0;
			quota.reset_at = new Date().toISOString();
			Ledger.saveQuotaLedger();
		}

		if (quota.requests < 18) {
			Logger.info(
				"SYSTEM",
				"CORE",
				"API_ACQUIRE",
				`Selected ${item.name} (${quota.requests}/18 requests used today)`,
			);
			return { name: item.name, key: val, index: i + 1 };
		}
	}

	const primary = process.env.GEMINI_API_KEY;
	if (primary) {
		Logger.warn(
			"SYSTEM",
			"CORE",
			"API_ACQUIRE",
			"All configured keys seem exhausted. Falling back to primary.",
		);
		return { name: "GEMINI_API_KEY", key: primary, index: 1 };
	}

	throw new QuotaExhaustionError("No API keys available.");
}

export function updateFromHeaders(
	key: string,
	headers: Record<string, unknown>,
) {
	Ledger.updateQuota(key, 1, 0);
}

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
