import path from "node:path";
import fs from "fs-extra";
import { ROOT } from "../base.js";
import { AgentLogger as Logger } from "./logger.js";

export class QuotaExhaustionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "QuotaExhaustionError";
	}
}

interface QuotaState {
	remaining: number;
	remainingTokens: number;
	resetTime: number;
	status: "active" | "cooldown";
	lastUsed: number;
	backoffLevel: number;
}

interface QuotaLedger {
	keys: Record<string, QuotaState>;
	sessions: Record<string, number>;
}

interface QuotaMetric {
	timestamp: string;
	keyName: string;
	requestsRemaining: number;
	tokensRemaining: number;
	backoffLevel: number;
	waited: number;
}

const LEDGER_PATH = path.join(ROOT, "data/state/llm_quotas.json");
const METRICS_PATH = path.join(ROOT, "logs/quota_metrics.jsonl");
const RATE_LIMIT_THRESHOLD = 0.3; // 30%

export class QuotaManager {
	private static ledger: QuotaLedger | null = null;
	private static readonly quotaMutex = { locked: false };

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
		const tempPath = `${LEDGER_PATH}.tmp`;
		fs.writeJsonSync(tempPath, QuotaManager.ledger, { spaces: 2 });
		fs.renameSync(tempPath, LEDGER_PATH);
	}

	private static recordMetric(metric: QuotaMetric) {
		fs.ensureDirSync(path.dirname(METRICS_PATH));
		fs.appendFileSync(METRICS_PATH, JSON.stringify(metric) + "\n");
	}

	private static syncEnvKeys() {
		const ledger = QuotaManager.loadLedger();
		const envKeys = Object.entries(process.env)
			.filter(
				([name, value]) =>
					name.startsWith("GEMINI_API_KEY") &&
					name !== "GEMINI_API_KEY_5" &&
					value &&
					value.length > 20 &&
					!value.includes("YOUR_API_KEY"),
			)
			.sort(([a], [b]) => {
				const na = Number.parseInt(a.split("_").pop() || "0");
				const nb = Number.parseInt(b.split("_").pop() || "0");
				return na - nb;
			});

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
					remainingTokens: 1000000,
					resetTime: 0,
					status: "active",
					lastUsed: 0,
					backoffLevel: 0,
				};
			}
		}
		QuotaManager.saveLedger();
	}

	private static calculateBackoffDelay(backoffLevel: number): number {
		const baseDelay = 1000; // 1 second
		const maxDelay = 60000; // 60 seconds
		const exponentialDelay = Math.min(
			baseDelay * Math.pow(2, backoffLevel),
			maxDelay,
		);
		const jitter = Math.random() * exponentialDelay * 0.1;
		return exponentialDelay + jitter;
	}

	public static async waitIfRateLimited(keyName: string): Promise<number> {
		const ledger = QuotaManager.loadLedger();
		const state = ledger.keys[keyName];
		if (!state) return 0;

		const now = Date.now();
		let waited = 0;

		// Check if key is in cooldown
		if (state.status === "cooldown" && state.resetTime > now) {
			const cooldownDuration = state.resetTime - now;
			Logger.warn(
				"SYSTEM",
				"QUOTA",
				"COOLDOWN",
				`Key ${keyName} in cooldown. Waiting ${cooldownDuration}ms`,
			);
			await new Promise((resolve) => setTimeout(resolve, cooldownDuration));
			waited = cooldownDuration;
			state.status = "active";
			state.backoffLevel = 0;
			QuotaManager.saveLedger();
		}

		// Check if approaching rate limit (< 30% remaining)
		const remainingPercent = state.remaining / 15; // Assuming 15 is max per minute
		if (remainingPercent < RATE_LIMIT_THRESHOLD) {
			const backoffDelay = QuotaManager.calculateBackoffDelay(
				state.backoffLevel,
			);
			Logger.info(
				"SYSTEM",
				"QUOTA",
				"BACKOFF",
				`Key ${keyName} at ${(remainingPercent * 100).toFixed(1)}%. Backing off for ${backoffDelay.toFixed(0)}ms (level=${state.backoffLevel})`,
			);
			await new Promise((resolve) => setTimeout(resolve, backoffDelay));
			waited += backoffDelay;
			state.backoffLevel = Math.min(state.backoffLevel + 1, 6); // Cap at 6 (64 seconds)
		}

		QuotaManager.saveLedger();
		return waited;
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
			const err = new QuotaExhaustionError(
				"No valid Gemini API keys available. All keys are exhausted or in cooldown.",
			);
			Logger.error("SYSTEM", "QUOTA", "EXHAUSTION", err.message);
			throw err;
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
			`Selected Key ${best.index} (Remaining: ${best.state.remaining}/${best.state.remainingTokens} tokens)`,
		);
		return { name: best.name, key: best.key, index: best.index };
	}

	public static updateFromHeaders(
		keyName: string,
		headers: Record<string, unknown>,
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
		const remainingTokens =
			headers["x-ratelimit-remaining-tokens"] ||
			headers["X-RateLimit-Remaining-Tokens"];

		if (remaining) {
			const remVal = Array.isArray(remaining) ? remaining[0] : remaining;
			state.remaining = Number.parseInt(String(remVal));
		}
		if (remainingTokens) {
			const tokVal = Array.isArray(remainingTokens)
				? remainingTokens[0]
				: remainingTokens;
			state.remainingTokens = Number.parseInt(String(tokVal));
		}
		if (reset) {
			const resetStr = String(Array.isArray(reset) ? reset[0] : reset);
			if (resetStr.endsWith("s")) {
				state.resetTime = Date.now() + Number.parseInt(resetStr) * 1000 + 1000;
			} else {
				state.resetTime = new Date(resetStr).getTime() + 1000;
			}
		}

		// Check if we should trigger rate limiting
		const remainingPercent = state.remaining / 15;
		const tokenPercent = state.remainingTokens / 1000000;
		const threshold = Math.min(remainingPercent, tokenPercent);

		if (threshold < RATE_LIMIT_THRESHOLD) {
			state.status = "cooldown";
			state.resetTime =
				Date.now() + QuotaManager.calculateBackoffDelay(state.backoffLevel);
		} else if (state.remaining === 0 || state.remainingTokens === 0) {
			state.status = "cooldown";
			state.resetTime = Date.now() + 65000; // Default 65 second cooldown
		} else {
			state.status = "active";
			state.backoffLevel = 0; // Reset backoff when quota recovers
		}

		// Record metric
		QuotaManager.recordMetric({
			timestamp: new Date().toISOString(),
			keyName,
			requestsRemaining: state.remaining,
			tokensRemaining: state.remainingTokens,
			backoffLevel: state.backoffLevel,
			waited: 0,
		});

		QuotaManager.saveLedger();
	}

	public static markCooldown(keyName: string, durationMs = 65000) {
		const ledger = QuotaManager.loadLedger();
		const state = ledger.keys[keyName];
		if (state) {
			state.status = "cooldown";
			state.remaining = 0;
			state.resetTime = Date.now() + durationMs;
			state.backoffLevel = Math.min(state.backoffLevel + 1, 6);
			QuotaManager.saveLedger();
			Logger.error(
				"SYSTEM",
				"QUOTA",
				"FAILURE",
				`Key ${keyName} forced to cooldown for ${durationMs}ms (backoff level ${state.backoffLevel})`,
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
			return "[LLM System Status]\\nProvider: LOCAL FALLBACK (vLLM/Qwen3.5-9B)\\nConstraint: Context window is strictly limited to 4096 tokens.\\nStrategic Guidance: Prioritize core facts. Be extremely concise to avoid context truncation.";
		}

		if (!state)
			return "[LLM System Status]\\nProvider: Gemini 3 Flash\\nStatus: Initializing cluster nodes.";

		const index = Number.parseInt(keyName.split("_").pop() || "1");
		const requestPercent = (state.remaining / 15) * 100;
		const tokenPercent = (state.remainingTokens / 1000000) * 100;
		const status =
			requestPercent < 30 || tokenPercent < 30 ? "LOW_QUOTA" : "OPTIMAL";
		const guidance =
			status === "LOW_QUOTA"
				? `Remaining quota is limited (${requestPercent.toFixed(0)}% requests, ${tokenPercent.toFixed(0)}% tokens). Complete the current task efficiently.`
				: "Standard operational mode.";

		return `[LLM System Status]\\nProvider: Gemini 3 Flash (Cluster Node ${index})\\nRemaining: ${state.remaining} requests, ${state.remainingTokens} tokens\\nPerformance: ${status}\\nBackoff Level: ${state.backoffLevel}\\nStrategic Guidance: ${guidance}`;
	}
}
