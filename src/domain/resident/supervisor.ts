import crypto from "node:crypto";
import { z } from "zod";
import type {
	BenchmarkCheck,
	BenchmarkProduct,
	RunBenchmarkResult,
} from "../benchmark/evaluators.js";

export type AnomalySignal = {
	code: string;
	product: BenchmarkProduct | "ops";
	severity: "critical" | "warning";
	latest_run_id: string | null;
	summary: string;
};

export const SupervisorAdvisorySchema = z.object({
	root_cause_hypothesis: z.string().min(10),
	concept_or_policy_refresh: z.string().min(10),
	smallest_next_action: z.string().min(10),
	verification_command: z.string().min(3),
});

export type SupervisorAdvisory = z.infer<typeof SupervisorAdvisorySchema>;

export type SupervisionEvaluation = {
	state_fingerprint: string;
	anomaly_fingerprint: string;
	anomalies: AnomalySignal[];
	dbt_needed: boolean;
	advisory_needed: boolean;
};

function sha256Short(payload: unknown): string {
	return crypto
		.createHash("sha256")
		.update(JSON.stringify(payload))
		.digest("hex")
		.slice(0, 16);
}

/**
 * Pure 0-token deterministic detector for channel anomalies and bias trends.
 * Inspects only structured L1 benchmark results and cross-run checks (never raw media/logs).
 */
export function detectAnomaliesAndBias(input: {
	byosanRuns: RunBenchmarkResult[];
	yawaRuns: RunBenchmarkResult[];
	humanityRuns: RunBenchmarkResult[];
	yawaCrossChecks: BenchmarkCheck[];
	analyticsRows: number;
}): {
	anomalies: AnomalySignal[];
	state_fingerprint: string;
	anomaly_fingerprint: string;
} {
	const anomalies: AnomalySignal[] = [];

	const inspectLatest = (
		product: BenchmarkProduct,
		runs: RunBenchmarkResult[],
	) => {
		const latest = runs[0];
		if (!latest) return;
		for (const check of latest.checks) {
			if (check.status === "FAIL") {
				anomalies.push({
					code: `${product}:${check.id}`,
					product,
					severity: check.severity,
					latest_run_id: latest.run_id,
					summary: check.message,
				});
			}
		}
		// Repeated failure trend across latest 3 runs
		const recent3 = runs.slice(0, 3);
		if (recent3.length >= 3 && recent3.every((r) => r.status === "FAIL")) {
			anomalies.push({
				code: `${product}:consecutive_fail_trend`,
				product,
				severity: "critical",
				latest_run_id: latest.run_id,
				summary: `All ${recent3.length} most recent ${product} runs failed L1 benchmark`,
			});
		}
	};

	inspectLatest("byosan", input.byosanRuns);
	inspectLatest("yawa", input.yawaRuns);
	inspectLatest("humanity", input.humanityRuns);

	// Bias / convergence checks (e.g., cast monotony, late-night care convergence)
	for (const cross of input.yawaCrossChecks) {
		if (cross.status === "WARN" || cross.status === "FAIL") {
			anomalies.push({
				code: `yawa:bias:${cross.id}`,
				product: "yawa",
				severity: "warning",
				latest_run_id: input.yawaRuns[0]?.run_id ?? null,
				summary: cross.message,
			});
		}
	}

	const stateFingerprint = sha256Short({
		analyticsRows: input.analyticsRows,
		byosan: input.byosanRuns.slice(0, 3).map((r) => [r.run_id, r.status]),
		yawa: input.yawaRuns.slice(0, 3).map((r) => [r.run_id, r.status]),
		humanity: input.humanityRuns.slice(0, 3).map((r) => [r.run_id, r.status]),
		yawaCross: input.yawaCrossChecks.map((c) => [c.id, c.status]),
	});

	const anomalyFingerprint =
		anomalies.length === 0
			? "clean"
			: sha256Short(
					anomalies.map((a) => `${a.code}@${a.latest_run_id ?? "none"}`).sort(),
				);

	return {
		anomalies,
		state_fingerprint: stateFingerprint,
		anomaly_fingerprint: anomalyFingerprint,
	};
}

export function decideTokenMinimalActions(input: {
	previousStateFingerprint: string | null;
	previousAnomalyFingerprint: string | null;
	previousAnalyticsRows: number | null;
	currentStateFingerprint: string;
	currentAnomalyFingerprint: string;
	currentAnalyticsRows: number;
	anomalies: AnomalySignal[];
	duckdbExists: boolean;
}): SupervisionEvaluation {
	const dbtNeeded =
		!input.duckdbExists ||
		input.previousAnalyticsRows !== input.currentAnalyticsRows;
	const advisoryNeeded =
		input.anomalies.length > 0 &&
		input.currentAnomalyFingerprint !== input.previousAnomalyFingerprint;
	return {
		state_fingerprint: input.currentStateFingerprint,
		anomaly_fingerprint: input.currentAnomalyFingerprint,
		anomalies: input.anomalies,
		dbt_needed: dbtNeeded,
		advisory_needed: advisoryNeeded,
	};
}

export function buildCompactAdvisoryPrompt(anomalies: AnomalySignal[]): string {
	const compact = anomalies.slice(0, 8).map((a) => ({
		code: a.code,
		severity: a.severity,
		run: a.latest_run_id,
		summary: a.summary.slice(0, 160),
	}));
	return [
		"あなたは YT3（秒算マネー・夜話アーカイブ・雨晴はうの人類観測所）の常駐監督エージェントです。",
		"以下は決定論チェックで新規検知された異常・偏りの最小差分（JSON）です。",
		"トークン節約のため簡潔に、根本原因仮説・方針または設計の最小刷新案・次に取る最小一手・検証コマンドを返してください。",
		JSON.stringify(compact),
	].join("\n");
}
