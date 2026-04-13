export class QuotaExhaustionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "QuotaExhaustionError";
	}
}

export interface QuotaState {
	remaining: number;
	remainingTokens: number;
	resetTime: number;
	status: "active" | "cooldown";
	lastUsed: number;
	backoffLevel: number;
}

export interface QuotaLedger {
	keys: Record<string, QuotaState>;
	sessions: Record<string, number>;
}

export interface QuotaMetric {
	timestamp: string;
	keyName: string;
	requestsRemaining: number;
	tokensRemaining: number;
	backoffLevel: number;
	waited: number;
}
