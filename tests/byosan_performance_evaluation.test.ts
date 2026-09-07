import { describe, expect, test } from "bun:test";
import {
	type ByosanAnalyticsEvaluationCandidate,
	type ByosanAnalyticsEvaluationPlan,
	evaluateByosanAnalyticsCandidates,
	hashByosanAnalyticsEvaluationPlan,
} from "../src/domain/byosan/performance_evaluation.js";

function plan(): ByosanAnalyticsEvaluationPlan {
	return {
		schemaVersion: "byosan_analytics_evaluation_plan_v1",
		baselineRevision: "58ec83c2c03926ed150c430b9be85bdb739f0607",
		policyVersion: "anti_gaming_v1",
		format: "comparison",
		packagingKnobs: ["relative_anchor", "title_structure"],
		window: "first_7d",
		sampleMinimum: 2,
		primaryMetric: "averageViewPercentage",
		secondaryMetrics: ["watchTimeMinutes", "subscribersGained", "views"],
		metricFloors: {
			views: 500,
			watchTimeMinutes: 200,
			averageViewPercentage: 45,
			subscribersGained: 0,
		},
		hardGateNames: [
			"factual_integrity",
			"source_quality",
			"narrative_contract",
		],
		createdAt: "2026-09-07T03:00:00.000Z",
	};
}

function candidate(
	overrides: Partial<ByosanAnalyticsEvaluationCandidate> = {},
): ByosanAnalyticsEvaluationCandidate {
	return {
		candidateId: "candidate-a1",
		evaluationUnitId: "run-a",
		attemptNumber: 1,
		format: "comparison",
		packagingPattern: "relative",
		evidenceKind: "production",
		hardGateFailures: [],
		metrics: {
			views: 1000,
			watchTimeMinutes: 500,
			averageViewPercentage: 60,
			subscribersGained: 10,
		},
		...overrides,
	};
}

describe("byosan analytics anti-gaming evaluation", () => {
	test("retry attempts are not independent samples or best-of-N candidates", () => {
		const result = evaluateByosanAnalyticsCandidates(plan(), [
			candidate({
				candidateId: "run-a-first",
				evaluationUnitId: "run-a",
				attemptNumber: 1,
				metrics: {
					views: 900,
					watchTimeMinutes: 410,
					averageViewPercentage: 55,
					subscribersGained: 8,
				},
			}),
			candidate({
				candidateId: "run-a-lucky-retry",
				evaluationUnitId: "run-a",
				attemptNumber: 2,
				metrics: {
					views: 99999,
					watchTimeMinutes: 99999,
					averageViewPercentage: 99,
					subscribersGained: 999,
				},
			}),
			candidate({
				candidateId: "run-b-first",
				evaluationUnitId: "run-b",
				metrics: {
					views: 1200,
					watchTimeMinutes: 600,
					averageViewPercentage: 65,
					subscribersGained: 12,
				},
			}),
		]);
		expect(result.status).toBe("READY");
		expect(result.sampleCount).toBe(2);
		expect(result.preferredEvaluationUnitId).toBe("run-b");
		const runA = result.units.find((unit) => unit.evaluationUnitId === "run-a");
		expect(runA?.selectedCandidateId).toBe("run-a-first");
		expect(runA?.reasonCodes).toContain("retry_attempts_ignored:1");
	});

	test("hard gate failure cannot be offset by engagement", () => {
		const result = evaluateByosanAnalyticsCandidates(plan(), [
			candidate({
				evaluationUnitId: "bad-facts",
				candidateId: "bad-facts-a1",
				hardGateFailures: ["factual_integrity"],
				metrics: {
					views: 1000000,
					watchTimeMinutes: 100000,
					averageViewPercentage: 99,
					subscribersGained: 10000,
				},
			}),
			candidate({
				evaluationUnitId: "good-a",
				candidateId: "good-a1",
			}),
		]);
		const rejected = result.units.find(
			(unit) => unit.evaluationUnitId === "bad-facts",
		);
		expect(rejected?.verdict).toBe("REJECTED");
		expect(rejected?.reasonCodes).toContain(
			"hard_gate_failed:factual_integrity",
		);
		expect(result.preferredEvaluationUnitId).toBe("good-a");
	});

	test("one metric below its floor rejects the candidate instead of averaging it away", () => {
		const result = evaluateByosanAnalyticsCandidates(plan(), [
			candidate({
				evaluationUnitId: "low-retention",
				candidateId: "low-retention-a1",
				metrics: {
					views: 50000,
					watchTimeMinutes: 10000,
					averageViewPercentage: 44,
					subscribersGained: 200,
				},
			}),
			candidate({
				evaluationUnitId: "good-a",
				candidateId: "good-a1",
			}),
		]);
		const rejected = result.units.find(
			(unit) => unit.evaluationUnitId === "low-retention",
		);
		expect(rejected?.verdict).toBe("REJECTED");
		expect(rejected?.reasonCodes).toContain(
			"metric_floor_failed:averageViewPercentage",
		);
	});

	test("synthetic evidence never counts as production effect", () => {
		const result = evaluateByosanAnalyticsCandidates(plan(), [
			candidate({
				evaluationUnitId: "fixture",
				candidateId: "fixture-a1",
				evidenceKind: "synthetic",
			}),
			candidate({
				evaluationUnitId: "real",
				candidateId: "real-a1",
			}),
		]);
		expect(result.sampleCount).toBe(1);
		expect(result.status).toBe("INSUFFICIENT_DATA");
		expect(
			result.units.find((unit) => unit.evaluationUnitId === "fixture")?.verdict,
		).toBe("UNVERIFIED");
	});

	test("evaluation plan hash changes when the frozen policy changes", () => {
		const original = plan();
		const changed = { ...original, sampleMinimum: original.sampleMinimum + 1 };
		expect(hashByosanAnalyticsEvaluationPlan(original)).not.toBe(
			hashByosanAnalyticsEvaluationPlan(changed),
		);
	});
});
