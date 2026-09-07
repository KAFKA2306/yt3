import { createHash } from "node:crypto";
import { z } from "zod";
import { ByosanProductionFormatSchema } from "./news_angle.js";

export const ByosanAnalyticsMetricSchema = z.enum([
	"views",
	"watchTimeMinutes",
	"averageViewPercentage",
	"subscribersGained",
]);

export const ByosanAnalyticsMetricVectorSchema = z.object({
	views: z.number().min(0),
	watchTimeMinutes: z.number().min(0),
	averageViewPercentage: z.number().min(0).max(100),
	subscribersGained: z.number(),
});

export const ByosanAnalyticsEvaluationPlanSchema = z
	.object({
		schemaVersion: z.literal("byosan_analytics_evaluation_plan_v1"),
		baselineRevision: z.string().min(7).max(80),
		policyVersion: z.string().min(1).max(80),
		format: ByosanProductionFormatSchema,
		packagingKnobs: z
			.array(
				z.enum([
					"freshness",
					"relative_anchor",
					"impact",
					"duration_bucket",
					"title_structure",
				]),
			)
			.min(1),
		window: z.literal("first_7d"),
		sampleMinimum: z.number().int().min(2),
		primaryMetric: ByosanAnalyticsMetricSchema,
		secondaryMetrics: z.array(ByosanAnalyticsMetricSchema).min(3).max(3),
		metricFloors: ByosanAnalyticsMetricVectorSchema,
		hardGateNames: z.array(z.string().min(1)).min(1),
		createdAt: z.string().datetime(),
	})
	.superRefine((plan, context) => {
		const metrics = new Set([plan.primaryMetric, ...plan.secondaryMetrics]);
		for (const metric of ByosanAnalyticsMetricSchema.options) {
			if (!metrics.has(metric)) {
				context.addIssue({
					code: "custom",
					path: ["secondaryMetrics"],
					message: `evaluation plan must include metric ${metric}`,
				});
			}
		}
		if (metrics.size !== 4) {
			context.addIssue({
				code: "custom",
				path: ["secondaryMetrics"],
				message: "evaluation metrics must be unique",
			});
		}
	});

export const ByosanAnalyticsEvaluationCandidateSchema = z.object({
	candidateId: z.string().min(1),
	evaluationUnitId: z.string().min(1),
	attemptNumber: z.number().int().min(1),
	format: ByosanProductionFormatSchema,
	packagingPattern: z.string().min(1),
	evidenceKind: z.enum(["production", "synthetic"]),
	hardGateFailures: z.array(z.string().min(1)),
	metrics: ByosanAnalyticsMetricVectorSchema,
});

export const ByosanAnalyticsEvaluationUnitSchema = z.object({
	evaluationUnitId: z.string().min(1),
	selectedCandidateId: z.string().min(1),
	firstAttemptNumber: z.number().int().min(1),
	attemptCount: z.number().int().min(1),
	verdict: z.enum(["PASS", "REJECTED", "UNVERIFIED"]),
	reasonCodes: z.array(z.string()),
	metrics: ByosanAnalyticsMetricVectorSchema,
});

export const ByosanAnalyticsEvaluationResultSchema = z.object({
	schemaVersion: z.literal("byosan_analytics_evaluation_result_v1"),
	planHash: z.string().regex(/^[a-f0-9]{64}$/),
	status: z.enum(["READY", "INSUFFICIENT_DATA"]),
	sampleCount: z.number().int().min(0),
	eligibleCount: z.number().int().min(0),
	preferredEvaluationUnitId: z.string().min(1).optional(),
	units: z.array(ByosanAnalyticsEvaluationUnitSchema),
});

export type ByosanAnalyticsEvaluationPlan = z.infer<
	typeof ByosanAnalyticsEvaluationPlanSchema
>;
export type ByosanAnalyticsEvaluationCandidate = z.infer<
	typeof ByosanAnalyticsEvaluationCandidateSchema
>;
export type ByosanAnalyticsEvaluationResult = z.infer<
	typeof ByosanAnalyticsEvaluationResultSchema
>;

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, canonicalize(child)]),
		);
	}
	return value;
}

export function hashByosanAnalyticsEvaluationPlan(
	planInput: ByosanAnalyticsEvaluationPlan,
): string {
	const plan = ByosanAnalyticsEvaluationPlanSchema.parse(planInput);
	return createHash("sha256")
		.update(JSON.stringify(canonicalize(plan)))
		.digest("hex");
}

function metricFloorFailures(
	plan: ByosanAnalyticsEvaluationPlan,
	metrics: z.infer<typeof ByosanAnalyticsMetricVectorSchema>,
): string[] {
	return ByosanAnalyticsMetricSchema.options.flatMap((metric) =>
		metrics[metric] < plan.metricFloors[metric]
			? [`metric_floor_failed:${metric}`]
			: [],
	);
}

function compareMetrics(
	plan: ByosanAnalyticsEvaluationPlan,
	left: z.infer<typeof ByosanAnalyticsEvaluationUnitSchema>,
	right: z.infer<typeof ByosanAnalyticsEvaluationUnitSchema>,
): number {
	const orderedMetrics = [plan.primaryMetric, ...plan.secondaryMetrics];
	for (const metric of orderedMetrics) {
		const delta = right.metrics[metric] - left.metrics[metric];
		if (delta !== 0) return delta;
	}
	return left.evaluationUnitId.localeCompare(right.evaluationUnitId);
}

export function evaluateByosanAnalyticsCandidates(
	planInput: ByosanAnalyticsEvaluationPlan,
	candidateInputs: ByosanAnalyticsEvaluationCandidate[],
): ByosanAnalyticsEvaluationResult {
	const plan = ByosanAnalyticsEvaluationPlanSchema.parse(planInput);
	const candidates = candidateInputs.map((candidate) =>
		ByosanAnalyticsEvaluationCandidateSchema.parse(candidate),
	);
	const grouped = new Map<string, ByosanAnalyticsEvaluationCandidate[]>();
	for (const candidate of candidates) {
		const group = grouped.get(candidate.evaluationUnitId) ?? [];
		group.push(candidate);
		grouped.set(candidate.evaluationUnitId, group);
	}

	const units = [...grouped.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([evaluationUnitId, attempts]) => {
			const ordered = [...attempts].sort(
				(left, right) =>
					left.attemptNumber - right.attemptNumber ||
					left.candidateId.localeCompare(right.candidateId),
			);
			const first = ordered[0];
			if (!first) {
				throw new Error("BYOSAN_ANALYTICS_EVALUATION_UNIT_EMPTY");
			}
			const reasonCodes: string[] = [];
			let verdict: "PASS" | "REJECTED" | "UNVERIFIED" = "PASS";
			if (first.evidenceKind === "synthetic") {
				verdict = "UNVERIFIED";
				reasonCodes.push("synthetic_evidence_not_production");
			}
			if (first.format !== plan.format) {
				verdict = "REJECTED";
				reasonCodes.push("format_out_of_evaluation_plan");
			}
			if (first.hardGateFailures.length > 0) {
				verdict = "REJECTED";
				reasonCodes.push(
					...first.hardGateFailures.map((failure) => `hard_gate_failed:${failure}`),
				);
			}
			const floorFailures = metricFloorFailures(plan, first.metrics);
			if (floorFailures.length > 0) {
				verdict = "REJECTED";
				reasonCodes.push(...floorFailures);
			}
			if (ordered.length > 1) {
				reasonCodes.push(`retry_attempts_ignored:${ordered.length - 1}`);
			}
			return ByosanAnalyticsEvaluationUnitSchema.parse({
				evaluationUnitId,
				selectedCandidateId: first.candidateId,
				firstAttemptNumber: first.attemptNumber,
				attemptCount: ordered.length,
				verdict,
				reasonCodes,
				metrics: first.metrics,
			});
		});

	const productionSampleCount = units.filter(
		(unit) =>
			unit.verdict !== "UNVERIFIED" &&
			!unit.reasonCodes.includes("format_out_of_evaluation_plan"),
	).length;
	const eligible = units
		.filter((unit) => unit.verdict === "PASS")
		.sort((left, right) => compareMetrics(plan, left, right));
	const status =
		productionSampleCount >= plan.sampleMinimum && eligible.length > 0
			? "READY"
			: "INSUFFICIENT_DATA";
	return ByosanAnalyticsEvaluationResultSchema.parse({
		schemaVersion: "byosan_analytics_evaluation_result_v1",
		planHash: hashByosanAnalyticsEvaluationPlan(plan),
		status,
		sampleCount: productionSampleCount,
		eligibleCount: eligible.length,
		...(status === "READY" && eligible[0]
			? { preferredEvaluationUnitId: eligible[0].evaluationUnitId }
			: {}),
		units,
	});
}
