import path from "node:path";
import fs from "fs-extra";
import { ROOT } from "../base.js";
import { AgentLogger as Logger } from "./logger.js";

/**
 * QuotaManager (The Central Nervous System for Gemini Cluster)
 * Implements Quota Observation and Sticky Sessions as per 'Universal LLM Quota Orchestration' skill.
 */

interface QuotaState {
	remaining: number;
	resetTime: number; // ms timestamp
	status: "active" | "cooldown";
	lastUsed: number; // ms timestamp
}

interface QuotaLedger {
	keys: Record<string, QuotaState>;
	sessions: Record<string, number>; // sessionId -> keyIndex
}

const LEDGER_PATH = path.join(ROOT, "data/state/llm_quotas.json");

// biome-ignore lint/complexity/noStaticOnlyClass: Centralized singleton state for Quota Management
export class QuotaManager {
	private static ledger: QuotaLedger | null = null;

	private static loadLedger(): QuotaLedger {
		if (QuotaManager.ledger) return QuotaManager.ledger;
		if (fs.existsSync(LEDGER_PATH)) {
			QuotaManager.ledger = fs.readJsonSync(LEDGER_PATH);
		} else {
			QuotaManager.ledger = { keys: {}, sessions: {} };
		}
		return QuotaManager.ledger as QuotaLedger;
	}

	private static saveLedger() {
		if (!QuotaManager.ledger) return;
		fs.ensureDirSync(path.dirname(LEDGER_PATH));
		fs.writeJsonSync(LEDGER_PATH, QuotaManager.ledger, { spaces: 2 });
	}

	private static syncEnvKeys() {
		const ledger = QuotaManager.loadLedger();
		const envKeys = Object.entries(process.env)
			.filter(
				([name, value]) =>
					name.startsWith("GEMINI_API_KEY") &&
					name !== "GEMINI_API_KEY_5" && // Explicitly exclude invalid key
					value &&
					value.length > 20 &&
					!value.includes("YOUR_API_KEY"),
			)
			.sort(([a], [b]) => {
				const na = Number.parseInt(a.split("_").pop() || "0");
				const nb = Number.parseInt(b.split("_").pop() || "0");
				return na - nb;
			});

		// Clean up keys that no longer exist in env or are invalid
		const validNames = envKeys.map(([name]) => name);
		for (const name of Object.keys(ledger.keys)) {
			if (!validNames.includes(name)) {
				delete ledger.keys[name];
			}
		}

		for (const [name] of envKeys) {
			if (!ledger.keys[name]) {
				ledger.keys[name] = {
					remaining: 15,
					resetTime: 0,
					status: "active",
					lastUsed: 0,
				};
			}
		}
		QuotaManager.saveLedger();
	}

	public static acquireKey(sessionId?: string): {
		name: string;
		key: string;
		index: number;
	} {
		QuotaManager.syncEnvKeys();
		const ledger = QuotaManager.loadLedger();
		const now = Date.now();

		const getIndex = (name: string) => {
			const part = name.split("_").pop();
			const idx = Number.parseInt(part || "1");
			return Number.isNaN(idx) ? 1 : idx;
		};

		if (sessionId && ledger.sessions[sessionId]) {
			const stickyIndex = ledger.sessions[sessionId];
			const keyName =
				stickyIndex === 1 ? "GEMINI_API_KEY" : `GEMINI_API_KEY_${stickyIndex}`;
			const state = ledger.keys[keyName];

			if (state && (state.status === "active" || state.resetTime < now)) {
				const apiKey = process.env[keyName];
				if (apiKey) return { name: keyName, key: apiKey, index: stickyIndex };
			}
			Logger.warn(
				"SYSTEM",
				"QUOTA",
				"ACQUIRE",
				`Sticky key ${stickyIndex} is unusable or invalid. Rotating.`,
			);
		}

		const candidates = Object.entries(ledger.keys)
			.map(([name, state]) => ({
				name,
				index: getIndex(name),
				state,
				key: process.env[name],
			}))
			.filter(
				(
					c,
				): c is {
					name: string;
					index: number;
					state: QuotaState;
					key: string;
				} =>
					!!c.key && (c.state.status === "active" || c.state.resetTime < now),
			)
			.sort((a, b) => {
				if (b.state.remaining !== a.state.remaining)
					return b.state.remaining - a.state.remaining;
				return a.state.lastUsed - b.state.lastUsed;
			});

		if (candidates.length === 0) {
			throw new Error("QUOTA_EXHAUSTED: No valid Gemini API keys available.");
		}

		const best = candidates[0];
		if (!best)
			throw new Error("CRITICAL: Failed to select best key from cluster.");

		if (sessionId) ledger.sessions[sessionId] = best.index;
		best.state.lastUsed = now;
		QuotaManager.saveLedger();

		Logger.info(
			"SYSTEM",
			"QUOTA",
			"ACQUIRE",
			`Selected Key ${best.index} (Remaining: ${best.state.remaining})`,
		);
		return { name: best.name, key: best.key, index: best.index };
	}

	public static updateFromHeaders(
		keyName: string,
		headers: Record<string, any>,
	) {
		const ledger = QuotaManager.loadLedger();
		const state = ledger.keys[keyName];
		if (!state) return;

		const remaining =
			headers["x-ratelimit-remaining-requests"] ||
			headers["X-RateLimit-Remaining-Requests"];
		const reset =
			headers["x-ratelimit-reset-requests"] ||
			headers["X-RateLimit-Reset-Requests"];

		if (remaining) {
			const remVal = Array.isArray(remaining) ? remaining[0] : remaining;
			state.remaining = Number.parseInt(String(remVal));
		}
		if (reset) {
			const resetStr = String(Array.isArray(reset) ? reset[0] : reset);
			if (resetStr.endsWith("s")) {
				state.resetTime = Date.now() + Number.parseInt(resetStr) * 1000 + 1000;
			} else {
				state.resetTime = new Date(resetStr).getTime() + 1000;
			}
		}

		state.status = state.remaining === 0 ? "cooldown" : "active";
		QuotaManager.saveLedger();
	}

	public static markCooldown(keyName: string, durationMs = 65000) {
		const ledger = QuotaManager.loadLedger();
		const state = ledger.keys[keyName];
		if (state) {
			state.status = "cooldown";
			state.remaining = 0;
			state.resetTime = Date.now() + durationMs;
			QuotaManager.saveLedger();
			Logger.error(
				"SYSTEM",
				"QUOTA",
				"FAILURE",
				`Key ${keyName} forced to cooldown for ${durationMs}ms`,
			);
		}
	}

	public static getQuotaContext(
		keyName: string,
		provider: "gemini" | "local",
	): string {
		const ledger = QuotaManager.loadLedger();
		const state = ledger.keys[keyName];

		if (provider === "local") {
			return "[LLM System Status]\nProvider: LOCAL FALLBACK (vLLM/Qwen3.5-9B)\nConstraint: Context window is strictly limited to 4096 tokens.\nStrategic Guidance: Prioritize core facts. Be extremely concise to avoid context truncation.";
		}

		if (!state)
			return "[LLM System Status]\nProvider: Gemini 3 Flash\nStatus: Initializing cluster nodes.";

		const index = Number.parseInt(keyName.split("_").pop() || "1");
		const status = state.remaining < 5 ? "LOW_QUOTA" : "OPTIMAL";
		const guidance =
			status === "LOW_QUOTA"
				? "Remaining quota is limited. Complete the current task efficiently."
				: "Standard operational mode.";

		return `[LLM System Status]\nProvider: Gemini 3 Flash (Cluster Node ${index})\nRemaining Quota: ${state.remaining} requests\nPerformance: ${status}\nStrategic Guidance: ${guidance}`;
	}
}
