import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
describe("Issue #202 Goals → Signals → Metrics example", () => {
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
