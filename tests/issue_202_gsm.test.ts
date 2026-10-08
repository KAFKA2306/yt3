import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	GoalsSignalsMetricsPlanSchema,
	auditGoalsSignalsMetricsPlan,
} from "../src/domain/productivity/goals_signals_metrics.js";

const planPath = path.join(
	process.cwd(),
	"config/metrics/issue_202_goals_signals_metrics.json",
);
const examplePlan = JSON.parse(readFileSync(planPath, "utf8"));
const snapshotPath = path.join(
	process.cwd(),
	"config/metrics/snapshots/issue_202_ci_30d_20261008_063534.json",
);
const failureTriagePath = path.join(
	process.cwd(),
	"config/evidence/issue_202_failure_triage_20261008.json",
);
const licenseReviewPath = path.join(
	process.cwd(),
	"config/evidence/issue_202_license_review_20261008.json",
);
const episodePath = path.join(
	process.cwd(),
	"docs/series/issue-202_episode_draft.json",
);

describe("Issue #202 Goals → Signals → Metrics example", () => {
	test("keeps a source-backed, traceable repo metric set with recorded observations", async () => {
		const plan = JSON.parse(await readFile(planPath, "utf8"));
		const report = auditGoalsSignalsMetricsPlan(plan);

		expect(report).toMatchObject({
			status: "PASS",
			goal_count: 1,
			signal_count: 2,
			metric_count: 2,
			candidate_metric_count: 0,
			measured_metric_count: 2,
		});
		expect(
			plan.metrics.every(
				(metric: { status: string; value: number | null }) =>
					metric.status === "MEASURED" && metric.value !== null,
			),
		).toBe(true);
		expect(
			plan.metrics.map((metric: { value: number }) => metric.value),
		).toEqual([238, 75.5]);
		const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
		expect(snapshot.results.completed_first_attempts).toBe(102);
		expect(snapshot.window.from).toBe("2026-09-08T06:35:34Z");
		expect(snapshot.window.to).toBe("2026-10-08T06:35:34Z");
		expect(snapshot.results.conclusions).toEqual({ success: 77, failure: 25 });
		expect(snapshot.results.ci_workflow_elapsed_seconds.p95).toBe(
			plan.metrics[0].value,
		);
		expect(snapshot.results.ci_workflow_elapsed_seconds.median).toBe(125.5);
		expect(snapshot.results.ci_first_attempt_pass_rate_percent.numerator).toBe(
			77,
		);
		expect(
			snapshot.results.ci_first_attempt_pass_rate_percent.denominator,
		).toBe(102);
		expect(snapshot.results.ci_first_attempt_pass_rate_percent.value).toBe(
			plan.metrics[1].value,
		);
		const failureTriage = JSON.parse(readFileSync(failureTriagePath, "utf8"));
		expect(failureTriage.results.failed_workflow_runs_inspected).toBe(25);
		expect(
			failureTriage.results.failed_job_step_labels[
				"Episode production-quality render smoke"
			].count,
		).toBe(1);
		expect(
			failureTriage.results.failed_job_step_labels[
				"Episode canonical render smoke"
			].count,
		).toBe(1);
		expect(
			failureTriage.results.failed_job_step_labels["PR merge gate"].count,
		).toBe(23);
		const failureModes = Object.values(
			failureTriage.results.immediate_failure_modes,
		) as Array<{ count: number; run_ids: number[] }>;
		expect(
			failureTriage.results.immediate_failure_modes[
				"Biome lint/check command failed"
			].count,
		).toBe(20);
		expect(
			failureTriage.results.immediate_failure_modes[
				"TypeScript typecheck failed"
			].count,
		).toBe(2);
		expect(
			failureTriage.results.immediate_failure_modes["Unit-test timeout"].count,
		).toBe(1);
		expect(
			failureTriage.results.immediate_failure_modes[
				"Remotion smoke generated TSX syntax error"
			].count,
		).toBe(1);
		expect(
			failureTriage.results.immediate_failure_modes[
				"Canonical production smoke missing ffmpeg"
			].count,
		).toBe(1);
		expect(
			failureModes.map((mode) => mode.count).sort((a, b) => a - b),
		).toEqual([1, 1, 1, 2, 20]);
		expect(failureTriage.results.classification_scope).toContain(
			"deeper causal attribution",
		);
		expect(failureModes.reduce((total, mode) => total + mode.count, 0)).toBe(
			25,
		);
		expect(new Set(failureModes.flatMap((mode) => mode.run_ids)).size).toBe(25);
		const failureLabels = Object.values(
			failureTriage.results.failed_job_step_labels,
		) as Array<{ count: number; run_ids: number[] }>;
		expect(
			failureLabels.every((label) => label.run_ids.length === label.count),
		).toBe(true);
		expect(failureLabels.reduce((total, label) => total + label.count, 0)).toBe(
			failureTriage.results.failed_workflow_runs_inspected,
		);
		expect(new Set(failureLabels.flatMap((label) => label.run_ids)).size).toBe(
			failureTriage.results.failed_workflow_runs_inspected,
		);
		expect(
			failureModes.flatMap((mode) => mode.run_ids).sort((a, b) => a - b),
		).toEqual(
			failureLabels.flatMap((label) => label.run_ids).sort((a, b) => a - b),
		);
		const branchClusters = Object.values(
			failureTriage.results.head_branch_clusters,
		) as Array<{
			count: number;
			run_ids: number[];
			failure_mode_counts: Record<string, number>;
		}>;
		expect(
			failureTriage.results.head_branch_clusters["agent/issue-119-episode-json"]
				.count,
		).toBe(14);
		expect(
			failureTriage.results.head_branch_clusters["agent/issue-119-episode-json"]
				.failure_mode_counts,
		).toEqual({
			"Biome lint/check command failed": 13,
			"Canonical production smoke missing ffmpeg": 1,
		});
		expect(
			branchClusters.reduce((total, cluster) => total + cluster.count, 0),
		).toBe(25);
		const clusteredFailureModeCounts = new Map<string, number>();
		for (const cluster of branchClusters) {
			for (const [mode, count] of Object.entries(cluster.failure_mode_counts)) {
				clusteredFailureModeCounts.set(
					mode,
					(clusteredFailureModeCounts.get(mode) ?? 0) + count,
				);
			}
		}
		expect(Object.fromEntries(clusteredFailureModeCounts)).toEqual(
			Object.fromEntries(
				Object.entries(failureTriage.results.immediate_failure_modes).map(
					([mode, detail]) => [mode, detail.count],
				),
			),
		);
		expect(
			new Set(branchClusters.flatMap((cluster) => cluster.run_ids)).size,
		).toBe(25);
		expect(
			branchClusters
				.flatMap((cluster) => cluster.run_ids)
				.sort((a, b) => a - b),
		).toEqual(
			failureModes.flatMap((mode) => mode.run_ids).sort((a, b) => a - b),
		);
		const episode = JSON.parse(await readFile(episodePath, "utf8"));
		const sourceIds = new Set(
			episode.sources.map((source: { id: string }) => source.id),
		);
		const licenseReview = JSON.parse(readFileSync(licenseReviewPath, "utf8"));
		expect(plan.framework_source_ids).toEqual(["linkedin-dph-gsm"]);
		expect(
			plan.sources.find(
				(source: { id: string }) => source.id === "linkedin-dph-gsm",
			).role,
		).toBe("PRIMARY_FRAMEWORK");
		expect(sourceIds.has("linkedin-dph-gsm")).toBe(true);
		expect(licenseReview.status).toBe(
			"ALTERNATE_PRIMARY_SOURCE_FOUND_ATTRIBUTION_REQUIRED",
		);
		expect(licenseReview.unresolved).toContain(
			"YouTube channel/profile identity and authorization for this series",
		);
		expect(
			episode.claims.find(
				(claim: { id: string }) => claim.id === "claim-linkedin-license",
			).source_ids,
		).toEqual(["linkedin-dph-license", "cc-by-4-license"]);
		expect(
			episode.visuals.find(
				(visual: { id: string }) => visual.id === "attribution-card",
			).props,
		).toMatchObject({
			creator: "LinkedIn Corporation (2023)",
			license: "CC BY 4.0",
			endorsement: "No endorsement implied",
		});
		const failureEvidenceSource = episode.sources.find(
			(source: { id: string }) => source.id === "yt3-ci-failure-mode-evidence",
		);
		expect(failureEvidenceSource.url).toBe(
			"https://github.com/KAFKA2306/yt3/blob/fee5019609884a92dbd0665f62a102f2fad40b34/config/evidence/issue_202_failure_triage_20261008.json",
		);
		const branchClaim = episode.claims.find(
			(claim: { id: string }) => claim.id === "claim-head-branch-clusters",
		);
		expect(branchClaim.source_ids).toEqual([
			"github-actions-run-api",
			"yt3-ci-failure-mode-evidence",
		]);
		expect(
			episode.claims.every((claim: { source_ids: string[] }) =>
				claim.source_ids.every((sourceId) => sourceIds.has(sourceId)),
			),
		).toBe(true);
		expect(
			episode.visuals.find(
				(visual: { id: string }) => visual.id === "action-card",
			).props.largest_branch_cluster,
		).toContain("14/25 runs");
		expect(
			episode.sections
				.find((section: { id: string }) => section.id === "action")
				.dialogue.find((line: { id: string }) => line.id === "action-triage")
				.text,
		).toContain("Issue #119系列");
		expect(plan.metrics[1].limitations).toContain(
			"The unit is a workflow run, not a distinct pull request; multiple commits on one PR can create multiple run_attempt=1 records.",
		);
		expect(plan.anti_patterns).toContain(
			"Do not treat lines of code or commit counts as productivity outcomes.",
		);
	});

	test("rejects a signal that points to an unknown goal", () => {
		const result = GoalsSignalsMetricsPlanSchema.safeParse({
			schema_version: 1,
			plan_id: "broken-plan",
			observed_at: "2026-10-07T09:57:03Z",
			decision_question: "Which feedback bottleneck should be improved?",
			framework_source_ids: ["framework"],
			sources: [
				{
					id: "framework",
					title: "Engineering productivity measurement",
					url: "https://example.test/source",
					role: "PRIMARY_FRAMEWORK",
					accessed_on: "2026-10-07",
				},
			],
			goals: [
				{
					id: "safe-feedback",
					statement:
						"Changes receive trustworthy feedback without avoidable delay.",
					positive_action:
						"Inspect slow checks before considering optimization.",
					negative_action: "Keep required checks and investigate failures.",
				},
			],
			signals: [
				{
					id: "gate-feedback",
					goal_ids: ["missing-goal"],
					statement:
						"Required checks return an actionable result before merge.",
					measurement_state: "MEASURABLE",
				},
			],
			metrics: [],
			anti_patterns: ["Do not use activity counts as outcomes."],
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(
				result.error.issues.some((issue) =>
					issue.message.includes("unknown goal"),
				),
			).toBe(true);
		}
	});

	test("requires every measurable signal to have a linked metric", () => {
		const plan = structuredClone(examplePlan);
		plan.metrics = plan.metrics.filter(
			(metric) => !metric.signal_ids.includes("ci-outcome"),
		);
		expect(() => auditGoalsSignalsMetricsPlan(plan)).toThrow();
	});

	test("requires evidence before a candidate can be reported as measured", () => {
		const result = GoalsSignalsMetricsPlanSchema.safeParse({
			schema_version: 1,
			plan_id: "broken-measurement",
			observed_at: "2026-10-07T09:57:03Z",
			decision_question: "Which feedback bottleneck should be improved?",
			framework_source_ids: ["framework"],
			sources: [
				{
					id: "framework",
					title: "Engineering productivity measurement",
					url: "https://example.test/source",
					role: "PRIMARY_FRAMEWORK",
					accessed_on: "2026-10-07",
				},
				{
					id: "actions",
					title: "Workflow run data",
					url: "https://example.test/actions",
					role: "METRIC_DATA_SOURCE",
					accessed_on: "2026-10-07",
				},
			],
			goals: [
				{
					id: "safe-feedback",
					statement:
						"Changes receive trustworthy feedback without avoidable delay.",
					positive_action:
						"Inspect slow checks before considering optimization.",
					negative_action: "Keep required checks and investigate failures.",
				},
			],
			signals: [
				{
					id: "gate-feedback",
					goal_ids: ["safe-feedback"],
					statement:
						"Required checks return an actionable result before merge.",
					measurement_state: "MEASURABLE",
				},
			],
			metrics: [
				{
					id: "gate-latency",
					signal_ids: ["gate-feedback"],
					name: "Merge-gate latency",
					definition: "Elapsed time for a completed required CI run.",
					unit: "seconds",
					data_source_ids: ["actions"],
					formula: "completed_at - run_started_at",
					aggregation: "p50 and p95 over a stated observation window",
					observation_window: "rolling 30 days",
					status: "MEASURED",
					value: 300,
					evidence_urls: [],
					limitations: ["CI duration is not equivalent to human waiting time."],
				},
			],
			anti_patterns: ["Do not use activity counts as outcomes."],
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(
				result.error.issues.some((issue) =>
					issue.message.includes("measured metrics require"),
				),
			).toBe(true);
		}
	});
	test("requires framework references to use PRIMARY_FRAMEWORK sources", () => {
		const plan = structuredClone(examplePlan);
		plan.framework_source_ids = ["github-actions-run-api"];
		const result = GoalsSignalsMetricsPlanSchema.safeParse(plan);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(
				result.error.issues.some((issue) =>
					issue.message.includes("role PRIMARY_FRAMEWORK"),
				),
			).toBe(true);
		}
	});

	test("requires metric data references to use METRIC_DATA_SOURCE sources", () => {
		const plan = structuredClone(examplePlan);
		plan.metrics[0].data_source_ids = ["linkedin-dph-gsm"];
		const result = GoalsSignalsMetricsPlanSchema.safeParse(plan);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(
				result.error.issues.some((issue) =>
					issue.message.includes("role METRIC_DATA_SOURCE"),
				),
			).toBe(true);
		}
	});

	test("rejects a measurable signal linked only to not-measurable metrics", () => {
		const plan = structuredClone(examplePlan);
		const metric = plan.metrics.find(
			(item) => item.id === "ci-first-attempt-pass-rate",
		);
		if (!metric) {
			throw new Error("CI pass-rate metric fixture is missing");
		}
		metric.status = "NOT_MEASURABLE";
		metric.value = null;
		metric.evidence_urls = [];
		const result = GoalsSignalsMetricsPlanSchema.safeParse(plan);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(
				result.error.issues.some((issue) =>
					issue.message.includes("no viable candidate or measured metric"),
				),
			).toBe(true);
		}
	});

	test("rejects a not-measurable signal linked to a measured metric", () => {
		const plan = structuredClone(examplePlan);
		const signal = plan.signals.find((item) => item.id === "ci-outcome");
		if (!signal) {
			throw new Error("CI outcome signal fixture is missing");
		}
		signal.measurement_state = "NOT_MEASURABLE";
		const result = GoalsSignalsMetricsPlanSchema.safeParse(plan);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(
				result.error.issues.some((issue) =>
					issue.message.includes(
						"not-measurable signal links to a viable metric",
					),
				),
			).toBe(true);
		}
	});

	test("rejects a not-yet-measured signal linked to a measured metric", () => {
		const plan = structuredClone(examplePlan);
		const signal = plan.signals.find((item) => item.id === "ci-outcome");
		if (!signal) {
			throw new Error("CI outcome signal fixture is missing");
		}
		signal.measurement_state = "NOT_YET_MEASURED";
		const result = GoalsSignalsMetricsPlanSchema.safeParse(plan);
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(
				result.error.issues.some((issue) =>
					issue.message.includes(
						"not-yet-measured signal links to a measured metric",
					),
				),
			).toBe(true);
		}
	});
});
