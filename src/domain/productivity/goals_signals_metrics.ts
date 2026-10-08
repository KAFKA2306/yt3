import { z } from "zod";

const IdSchema = z.string().regex(/^[a-z][a-z0-9_-]*$/);
const TextSchema = z.string().trim().min(1);

const SourceSchema = z
	.object({
		id: IdSchema,
		title: TextSchema,
		url: z.url(),
		role: z.enum(["PRIMARY_FRAMEWORK", "METRIC_DATA_SOURCE"]),
		accessed_on: z.iso.date(),
	})
	.strict();

const GoalSchema = z
	.object({
		id: IdSchema,
		statement: TextSchema,
		positive_action: TextSchema,
		negative_action: TextSchema,
	})
	.strict();

const SignalSchema = z
	.object({
		id: IdSchema,
		goal_ids: z.array(IdSchema).min(1),
		statement: TextSchema,
		measurement_state: z.enum([
			"MEASURABLE",
			"NOT_YET_MEASURED",
			"NOT_MEASURABLE",
		]),
	})
	.strict();

const MetricSchema = z
	.object({
		id: IdSchema,
		signal_ids: z.array(IdSchema).min(1),
		name: TextSchema,
		definition: TextSchema,
		unit: TextSchema,
		data_source_ids: z.array(IdSchema).min(1),
		formula: TextSchema,
		aggregation: TextSchema,
		observation_window: TextSchema,
		status: z.enum(["CANDIDATE", "MEASURED", "NOT_MEASURABLE"]),
		value: z.number().finite().nullable(),
		evidence_urls: z.array(z.url()),
		limitations: z.array(TextSchema).min(1),
	})
	.strict()
	.superRefine((metric, context) => {
		if (
			metric.status === "MEASURED" &&
			(metric.value === null || metric.evidence_urls.length === 0)
		) {
			context.addIssue({
				code: "custom",
				path: ["evidence_urls"],
				message: "measured metrics require a value and evidence URL",
			});
		}
		if (metric.status !== "MEASURED" && metric.value !== null) {
			context.addIssue({
				code: "custom",
				path: ["value"],
				message: "unmeasured metrics must not contain an observed value",
			});
		}
	});

export const GoalsSignalsMetricsPlanSchema = z
	.object({
		schema_version: z.literal(1),
		plan_id: IdSchema,
		observed_at: z.iso.datetime(),
		decision_question: TextSchema,
		framework_source_ids: z.array(IdSchema).min(1),
		sources: z.array(SourceSchema).min(1),
		goals: z.array(GoalSchema).min(1),
		signals: z.array(SignalSchema).min(1),
		metrics: z.array(MetricSchema).min(1),
		anti_patterns: z.array(TextSchema).min(1),
	})
	.strict()
	.superRefine((plan, context) => {
		const uniqueIds = (
			values: readonly string[],
			path: (string | number)[],
		) => {
			const seen = new Set<string>();
			for (const [index, value] of values.entries()) {
				if (seen.has(value)) {
					context.addIssue({
						code: "custom",
						path: [...path, index],
						message: `duplicate id: ${value}`,
					});
				}
				seen.add(value);
			}
		};

		uniqueIds(
			plan.sources.map((source) => source.id),
			["sources"],
		);
		uniqueIds(
			plan.goals.map((goal) => goal.id),
			["goals"],
		);
		uniqueIds(
			plan.signals.map((signal) => signal.id),
			["signals"],
		);
		uniqueIds(
			plan.metrics.map((metric) => metric.id),
			["metrics"],
		);

		const sourcesById = new Map(plan.sources.map((source) => [source.id, source]));
		const goalIds = new Set(plan.goals.map((goal) => goal.id));
		const signalIds = new Set(plan.signals.map((signal) => signal.id));
		const metricSignalIds = new Set(
			plan.metrics.flatMap((metric) => metric.signal_ids),
		);
		const mappedGoalIds = new Set(
			plan.signals.flatMap((signal) => signal.goal_ids),
		);
		for (const [index, sourceId] of plan.framework_source_ids.entries()) {
			const source = sourcesById.get(sourceId);
			if (!source) {
				context.addIssue({
					code: "custom",
					path: ["framework_source_ids", index],
					message: `unknown framework source: ${sourceId}`,
				});
			} else if (source.role !== "PRIMARY_FRAMEWORK") {
				context.addIssue({
					code: "custom",
					path: ["framework_source_ids", index],
					message: `framework source must have role PRIMARY_FRAMEWORK: ${sourceId}`,
				});
			}
		}
		for (const [index, goal] of plan.goals.entries()) {
			if (!mappedGoalIds.has(goal.id)) {
				context.addIssue({
					code: "custom",
					path: ["goals", index, "id"],
					message: `goal has no signal: ${goal.id}`,
				});
			}
		}
		for (const [signalIndex, signal] of plan.signals.entries()) {
			if (
				!metricSignalIds.has(signal.id) &&
				signal.measurement_state !== "NOT_MEASURABLE"
			) {
				context.addIssue({
					code: "custom",
					path: ["signals", signalIndex, "id"],
					message: `signal has no metric or explicit not-measurable state: ${signal.id}`,
				});
			}
			const linkedMetrics = plan.metrics.filter((metric) =>
				metric.signal_ids.includes(signal.id),
			);
			if (
				signal.measurement_state !== "NOT_MEASURABLE" &&
				linkedMetrics.length > 0 &&
				linkedMetrics.every((metric) => metric.status === "NOT_MEASURABLE")
			) {
				context.addIssue({
					code: "custom",
					path: ["signals", signalIndex, "measurement_state"],
					message: `signal has no viable candidate or measured metric: ${signal.id}`,
				});
			}
			if (
				signal.measurement_state === "NOT_MEASURABLE" &&
				linkedMetrics.some((metric) => metric.status !== "NOT_MEASURABLE")
			) {
				context.addIssue({
					code: "custom",
					path: ["signals", signalIndex, "measurement_state"],
					message: `not-measurable signal links to a viable metric: ${signal.id}`,
				});
			}
			if (
				signal.measurement_state === "NOT_YET_MEASURED" &&
				linkedMetrics.some((metric) => metric.status === "MEASURED")
			) {
				context.addIssue({
					code: "custom",
					path: ["signals", signalIndex, "measurement_state"],
					message: `not-yet-measured signal links to a measured metric: ${signal.id}`,
				});
			}
			for (const [goalIndex, goalId] of signal.goal_ids.entries()) {
				if (!goalIds.has(goalId)) {
					context.addIssue({
						code: "custom",
						path: ["signals", signalIndex, "goal_ids", goalIndex],
						message: `unknown goal: ${goalId}`,
					});
				}
			}
		}
		for (const [metricIndex, metric] of plan.metrics.entries()) {
			for (const [signalIndex, signalId] of metric.signal_ids.entries()) {
				if (!signalIds.has(signalId)) {
					context.addIssue({
						code: "custom",
						path: ["metrics", metricIndex, "signal_ids", signalIndex],
						message: `unknown signal: ${signalId}`,
					});
				}
			}
			for (const [sourceIndex, sourceId] of metric.data_source_ids.entries()) {
				const source = sourcesById.get(sourceId);
				if (!source) {
					context.addIssue({
						code: "custom",
						path: ["metrics", metricIndex, "data_source_ids", sourceIndex],
						message: `unknown metric data source: ${sourceId}`,
					});
				} else if (source.role !== "METRIC_DATA_SOURCE") {
					context.addIssue({
						code: "custom",
						path: ["metrics", metricIndex, "data_source_ids", sourceIndex],
						message: `metric data source must have role METRIC_DATA_SOURCE: ${sourceId}`,
					});
				}
			}
		}
	});

export type GoalsSignalsMetricsPlan = z.infer<
	typeof GoalsSignalsMetricsPlanSchema
>;

export function auditGoalsSignalsMetricsPlan(input: unknown) {
	const plan = GoalsSignalsMetricsPlanSchema.parse(input);
	return {
		status: "PASS" as const,
		plan_id: plan.plan_id,
		goal_count: plan.goals.length,
		signal_count: plan.signals.length,
		metric_count: plan.metrics.length,
		candidate_metric_count: plan.metrics.filter(
			(metric) => metric.status === "CANDIDATE",
		).length,
		measured_metric_count: plan.metrics.filter(
			(metric) => metric.status === "MEASURED",
		).length,
		not_measurable_metric_count: plan.metrics.filter(
			(metric) => metric.status === "NOT_MEASURABLE",
		).length,
	};
}
