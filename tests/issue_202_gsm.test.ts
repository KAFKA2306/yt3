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
	"config/metrics/snapshots/issue_202_ci_30d_20261007.json",
);
const failureTriagePath = path.join(
	process.cwd(),
	"config/evidence/issue_202_failure_triage_20261008.json",
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
		).toEqual([159, 71.6]);
		const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
		expect(snapshot.results.completed_first_attempts).toBe(88);
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
			"deeper causal attribution for each failure is not asserted",
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
});
