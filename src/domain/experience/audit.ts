import { z } from "zod";
import type { EpisodeTimelineItem } from "../episode/compiler.js";
import type { Episode } from "../episode/schema.js";
import { ExperienceLaneSchema } from "./schema.js";
import type { ExperienceProfile } from "./schema.js";

export interface ExperienceAuditIssue {
	code: string;
	path: string;
	message: string;
}

export const EXPERIENCE_VIEWER_QUESTION_DEADLINE_MS = 12_000;

export interface ExperienceViewerQuestionTimingEvidence {
	viewer_question: string;
	dialogue_id: string;
	question_end_ms: number;
	deadline_ms: number;
	measurement_basis: "cumulative_measured_dialogue_audio_duration";
}

export interface ExperienceViewerQuestionTimingAudit {
	evidence: ExperienceViewerQuestionTimingEvidence | null;
	issues: ExperienceAuditIssue[];
}

/**
 * Measures the end of the complete spoken line containing the exact contract
 * question. This conservative boundary uses measured dialogue audio durations,
 * not character-count or estimated speech-rate heuristics.
 */
export function auditExperienceViewerQuestionTiming(
	episode: Episode,
	timeline: readonly EpisodeTimelineItem[],
): ExperienceViewerQuestionTimingAudit {
	const experience = episode.experience;
	if (!experience) return { evidence: null, issues: [] };

	const questionDialogue = episode.sections
		.flatMap((section) => section.dialogue)
		.find((dialogue) => dialogue.text.includes(experience.viewer_question));
	if (!questionDialogue) {
		return {
			evidence: null,
			issues: [
				{
					code: "viewer_question_not_in_script",
					path: "experience.viewer_question",
					message: "the exact contract question must appear in spoken dialogue",
				},
			],
		};
	}

	const timing = timeline.find(
		(item) => item.dialogueId === questionDialogue.id,
	);
	if (!timing || !Number.isFinite(timing.endMs) || timing.endMs < 0) {
		return {
			evidence: null,
			issues: [
				{
					code: "viewer_question_timing_missing",
					path: `sections.${questionDialogue.id}.audio`,
					message:
						"measured audio timing is required for the viewer-question dialogue",
				},
			],
		};
	}

	if (timing.endMs > EXPERIENCE_VIEWER_QUESTION_DEADLINE_MS) {
		return {
			evidence: null,
			issues: [
				{
					code: "viewer_question_too_late",
					path: `sections.${questionDialogue.id}.audio`,
					message: `the complete viewer-question line ends at ${timing.endMs}ms, after the ${EXPERIENCE_VIEWER_QUESTION_DEADLINE_MS}ms deadline`,
				},
			],
		};
	}

	return {
		evidence: {
			viewer_question: experience.viewer_question,
			dialogue_id: questionDialogue.id,
			question_end_ms: timing.endMs,
			deadline_ms: EXPERIENCE_VIEWER_QUESTION_DEADLINE_MS,
			measurement_basis: "cumulative_measured_dialogue_audio_duration",
		},
		issues: [],
	};
}

const MetricValueSchema = z.number().finite().nonnegative().nullable();

export const ExperienceRendererMetricsSchema = z.object({
	schema_version: z.literal(1),
	engine: z.enum(["remotion-existing", "motion-canvas"]),
	lane: ExperienceLaneSchema.optional(),
	scene_id: z.string().min(1),
	started_at: z.string().datetime(),
	finished_at: z.string().datetime(),
	production_seconds: z.number().finite().nonnegative(),
	render_seconds: z.number().finite().nonnegative(),
	gpu_seconds: MetricValueSchema,
	manual_fix_count: z.number().int().nonnegative().nullable(),
	regeneration_count: z.number().int().nonnegative().nullable(),
	new_asset_count: z.number().int().nonnegative().nullable(),
	reused_asset_count: z.number().int().nonnegative().nullable(),
	asset_reuse_ratio: z.number().finite().min(0).max(1).nullable().optional(),
	source_lines_changed: z.number().int().nonnegative().nullable(),
	custom_code_lines: z.number().int().nonnegative().nullable(),
	dependency_lock_bytes: z.number().int().positive().nullable(),
	output_bytes: z.number().int().positive(),
	output_sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export type ExperienceRendererMetrics = z.infer<
	typeof ExperienceRendererMetricsSchema
>;

export const TtsGenerationManifestSchema = z.object({
	language: z.string().min(2),
	lane: ExperienceLaneSchema.optional(),
	generation_duration_basis: z.literal(
		"tts_synthesize_call_wall_clock_seconds",
	),
	records: z
		.array(
			z.object({
				generation_seconds: z.number().finite().nonnegative(),
			}),
		)
		.min(1),
});

export type TtsGenerationManifest = z.infer<typeof TtsGenerationManifestSchema>;

const AssetCountSummarySchema = z.object({
	total: z.number().int().nonnegative().nullable(),
	measured_metrics: z.number().int().nonnegative(),
	unmeasured_metrics: z.number().int().nonnegative(),
});

const DurationSummarySchema = z.object({
	total: z.number().finite().nonnegative(),
	mean: z.number().finite().nonnegative().nullable(),
});

const GenerationDurationSummarySchema = DurationSummarySchema.extend({
	measured_attempts: z.number().int().nonnegative(),
	manifest_count: z.number().int().nonnegative(),
});

const LaneCostSummarySchema = z.object({
	metric_count: z.number().int().nonnegative(),
	production_seconds: DurationSummarySchema,
	render_seconds: DurationSummarySchema,
	generation_seconds: GenerationDurationSummarySchema,
	new_asset_count: AssetCountSummarySchema,
	reused_asset_count: AssetCountSummarySchema,
});

export const ExperienceLaneCostSummarySchema = z.object({
	schema_version: z.literal(2),
	metrics_without_lane: z.number().int().nonnegative(),
	generation_manifests_without_lane: z.number().int().nonnegative(),
	generation_attempts_without_lane: z.number().int().nonnegative(),
	measurement_scope: z.object({
		duration_basis: z.literal("wall_clock_seconds_from_source_metrics"),
		durations_may_overlap: z.literal(true),
		input_metrics_deduplicated: z.literal(false),
		currency_cost_included: z.literal(false),
		human_labor_included: z.literal(false),
		generation_wall_seconds_measured: z.boolean(),
		generation_duration_basis: z
			.literal("tts_synthesize_call_wall_clock_seconds")
			.nullable(),
	}),
	by_lane: z.record(ExperienceLaneSchema, LaneCostSummarySchema),
});

export type ExperienceLaneCostSummary = z.infer<
	typeof ExperienceLaneCostSummarySchema
>;

type ExperienceLane = z.infer<typeof ExperienceLaneSchema>;

function summarizeDuration(
	values: number[],
): z.infer<typeof DurationSummarySchema> {
	const total = values.reduce((sum, value) => sum + value, 0);
	return {
		total,
		mean: values.length === 0 ? null : total / values.length,
	};
}

function summarizeAssetCount(
	values: Array<number | null>,
): z.infer<typeof AssetCountSummarySchema> {
	const measured = values.filter((value): value is number => value !== null);
	return {
		total:
			measured.length === 0
				? null
				: measured.reduce((sum, value) => sum + value, 0),
		measured_metrics: measured.length,
		unmeasured_metrics: values.length - measured.length,
	};
}

export function buildExperienceLaneCostSummary(
	metrics: readonly ExperienceRendererMetrics[],
	generationManifests: readonly TtsGenerationManifest[] = [],
): ExperienceLaneCostSummary {
	const byLane = Object.fromEntries(
		ExperienceLaneSchema.options.map((lane: ExperienceLane) => {
			const laneMetrics = metrics.filter((metric) => metric.lane === lane);
			const laneManifests = generationManifests.filter(
				(manifest) => manifest.lane === lane,
			);
			const generationSeconds = laneManifests.flatMap((manifest) =>
				manifest.records.map((record) => record.generation_seconds),
			);
			const generationTotal = generationSeconds.reduce(
				(sum, seconds) => sum + seconds,
				0,
			);
			return [
				lane,
				{
					metric_count: laneMetrics.length,
					production_seconds: summarizeDuration(
						laneMetrics.map((metric) => metric.production_seconds),
					),
					render_seconds: summarizeDuration(
						laneMetrics.map((metric) => metric.render_seconds),
					),
					generation_seconds: {
						total: generationTotal,
						mean:
							generationSeconds.length === 0
								? null
								: generationTotal / generationSeconds.length,
						measured_attempts: generationSeconds.length,
						manifest_count: laneManifests.length,
					},
					new_asset_count: summarizeAssetCount(
						laneMetrics.map((metric) => metric.new_asset_count),
					),
					reused_asset_count: summarizeAssetCount(
						laneMetrics.map((metric) => metric.reused_asset_count),
					),
				},
			];
		}),
	) as Record<ExperienceLane, z.infer<typeof LaneCostSummarySchema>>;

	return ExperienceLaneCostSummarySchema.parse({
		schema_version: 2,
		metrics_without_lane: metrics.filter((metric) => !metric.lane).length,
		generation_manifests_without_lane: generationManifests.filter(
			(manifest) => !manifest.lane,
		).length,
		generation_attempts_without_lane: generationManifests
			.filter((manifest) => !manifest.lane)
			.reduce((count, manifest) => count + manifest.records.length, 0),
		measurement_scope: {
			duration_basis: "wall_clock_seconds_from_source_metrics",
			durations_may_overlap: true,
			input_metrics_deduplicated: false,
			currency_cost_included: false,
			human_labor_included: false,
			generation_wall_seconds_measured: generationManifests.length > 0,
			generation_duration_basis:
				generationManifests.length > 0
					? "tts_synthesize_call_wall_clock_seconds"
					: null,
		},
		by_lane: byLane,
	});
}

export interface RendererMetricsInput {
	engine: ExperienceRendererMetrics["engine"];
	lane?: ExperienceRendererMetrics["lane"];
	scene_id: string;
	started_at: string;
	finished_at: string;
	render_seconds?: number;
	output_bytes: number;
	output_sha256: string;
	new_asset_count?: number | null;
	reused_asset_count?: number | null;
	source_lines_changed?: number | null;
	custom_code_lines?: number | null;
	dependency_lock_bytes?: number | null;
}

export function buildRendererMetrics(
	input: RendererMetricsInput,
): ExperienceRendererMetrics {
	const startedAt = Date.parse(input.started_at);
	const finishedAt = Date.parse(input.finished_at);
	if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) {
		throw new Error("renderer metrics require valid ISO timestamps");
	}
	if (finishedAt < startedAt)
		throw new Error("renderer finished_at precedes started_at");
	const newAssetCount = input.new_asset_count ?? null;
	const reusedAssetCount = input.reused_asset_count ?? null;
	const totalClassifiedAssets =
		newAssetCount === null || reusedAssetCount === null
			? null
			: newAssetCount + reusedAssetCount;
	const assetReuseRatio =
		newAssetCount === null ||
		reusedAssetCount === null ||
		totalClassifiedAssets === 0
			? null
			: reusedAssetCount / (newAssetCount + reusedAssetCount);
	return ExperienceRendererMetricsSchema.parse({
		schema_version: 1,
		...input,
		production_seconds: (finishedAt - startedAt) / 1000,
		render_seconds: input.render_seconds ?? (finishedAt - startedAt) / 1000,
		gpu_seconds: null,
		manual_fix_count: null,
		regeneration_count: null,
		new_asset_count: newAssetCount,
		reused_asset_count: reusedAssetCount,
		asset_reuse_ratio: assetReuseRatio,
		source_lines_changed: input.source_lines_changed ?? null,
		custom_code_lines: input.custom_code_lines ?? null,
		dependency_lock_bytes: input.dependency_lock_bytes ?? null,
	});
}

function isKnownAction(action: string, profile: ExperienceProfile): boolean {
	return profile.action_vocabulary.includes(
		action as (typeof profile.action_vocabulary)[number],
	);
}

export function countDistinctAssetsByStrategy(
	visuals: Episode["visuals"],
	strategy: "generated" | "reuse",
): number {
	const assetKeys = new Set<string>();
	for (const [index, visual] of visuals.entries()) {
		if (visual.asset_strategy !== strategy) continue;
		assetKeys.add(
			visual.asset_ref ? `asset:${visual.asset_ref}` : `visual:${index}`,
		);
	}
	return assetKeys.size;
}

export function countDistinctGeneratedAssets(
	visuals: Episode["visuals"],
): number {
	return countDistinctAssetsByStrategy(visuals, "generated");
}

export function auditExperienceEpisode(
	episode: Episode,
	profile: ExperienceProfile,
	options: { requiredLane?: ExperienceLane } = {},
): ExperienceAuditIssue[] {
	const issues: ExperienceAuditIssue[] = [];
	const assetIds = new Set(episode.assets.map((asset) => asset.id));
	const experience = episode.experience;
	if (!experience) {
		issues.push({
			code: "experience_missing",
			path: "experience",
			message: "byosan episodes require an Experience Contract",
		});
	} else {
		if (options.requiredLane && experience.lane !== options.requiredLane) {
			issues.push({
				code: "experience_lane_mismatch",
				path: "experience.lane",
				message: `task requires ${options.requiredLane} lane; episode declares ${experience.lane}`,
			});
		}
		if (!experience.viewer_question.trim()) {
			issues.push({
				code: "viewer_question_missing",
				path: "experience.viewer_question",
				message: "viewer question must not be empty",
			});
		}
		if (!experience.visible_change.trim()) {
			issues.push({
				code: "visible_change_missing",
				path: "experience.visible_change",
				message: "visible change must not be empty",
			});
		}
		if (!experience.visual_metaphor.trim()) {
			issues.push({
				code: "visual_metaphor_missing",
				path: "experience.visual_metaphor",
				message: "visual metaphor must not be empty",
			});
		}
	}
	if (!experience && options.requiredLane) {
		issues.push({
			code: "experience_lane_mismatch",
			path: "experience.lane",
			message: `task requires ${options.requiredLane} lane; episode declares no lane`,
		});
	}

	for (const visual of episode.visuals) {
		if (visual.asset_strategy === "reuse") {
			if (!visual.asset_ref) {
				issues.push({
					code: "asset_reuse_reference_missing",
					path: `visuals.${visual.id}.asset_ref`,
					message: "reuse strategy requires an explicit asset_ref",
				});
			} else if (!assetIds.has(visual.asset_ref)) {
				issues.push({
					code: "asset_reuse_reference_unknown",
					path: `visuals.${visual.id}.asset_ref`,
					message: `reused asset ${visual.asset_ref} is not declared by the episode`,
				});
			}
		}
		if (!visual.action) {
			issues.push({
				code: "scene_action_missing",
				path: `visuals.${visual.id}.action`,
				message: "every experience scene needs one visible action",
			});
			continue;
		}
		if (
			profile.forbidden_actions.some(
				(forbidden) => forbidden.toLowerCase() === visual.action?.toLowerCase(),
			)
		) {
			issues.push({
				code: "action_forbidden",
				path: `visuals.${visual.id}.action`,
				message: `action ${visual.action} describes instead of showing a visible change`,
			});
		} else if (!isKnownAction(visual.action, profile)) {
			issues.push({
				code: "action_unknown",
				path: `visuals.${visual.id}.action`,
				message: `action ${visual.action} is not in the channel vocabulary`,
			});
		}
	}

	if (!experience) return issues;
	const limits = profile.lane_limits[experience.lane];
	const concepts = new Set(
		episode.visuals.flatMap((visual) =>
			visual.concept_id ? [visual.concept_id] : [],
		),
	);
	const generatedAssets = countDistinctGeneratedAssets(episode.visuals);

	if (concepts.size > limits.max_concepts) {
		issues.push({
			code: "light_concept_limit",
			path: "visuals.concept_id",
			message: `${experience.lane} allows at most ${limits.max_concepts} concepts; found ${concepts.size}`,
		});
	}
	if (episode.visuals.length > limits.max_scenes) {
		issues.push({
			code: "light_scene_limit",
			path: "visuals",
			message: `${experience.lane} allows at most ${limits.max_scenes} scenes; found ${episode.visuals.length}`,
		});
	}
	if (generatedAssets > limits.max_generated_assets) {
		issues.push({
			code: "light_generated_asset_limit",
			path: "visuals.asset_strategy",
			message: `${experience.lane} allows at most ${limits.max_generated_assets} generated assets; found ${generatedAssets}`,
		});
	}
	return issues;
}

export interface ExperienceQualityScores {
	visual_quality: number;
	comprehension: number;
	identity_consistency: number;
}

export interface ExperienceBenchmarkComparison {
	scene_id: string;
	baseline: ExperienceRendererMetrics;
	motion_canvas: ExperienceRendererMetrics;
	human_evaluation?: {
		reviewer: string;
		reviewed_at: string;
		baseline: ExperienceQualityScores;
		motion_canvas: ExperienceQualityScores;
		notes?: string;
	};
}

function scoreDelta(
	baseline: number | undefined,
	candidate: number | undefined,
): number | null {
	return baseline === undefined || candidate === undefined
		? null
		: candidate - baseline;
}

export function buildExperienceBenchmarkSummary(
	comparisons: ExperienceBenchmarkComparison[],
) {
	return {
		schema_version: 1 as const,
		decision: "BENCHMARK_ONLY" as const,
		quality_evaluation_status: comparisons.every(
			(comparison) => comparison.human_evaluation,
		)
			? "HUMAN_REVIEWED"
			: "UNMEASURED",
		scenes: comparisons.map((comparison) => {
			const human = comparison.human_evaluation;
			return {
				scene_id: comparison.scene_id,
				baseline: comparison.baseline,
				motion_canvas: comparison.motion_canvas,
				production_delta: {
					production_seconds:
						comparison.motion_canvas.production_seconds -
						comparison.baseline.production_seconds,
					render_seconds:
						comparison.motion_canvas.render_seconds -
						comparison.baseline.render_seconds,
					output_bytes:
						comparison.motion_canvas.output_bytes -
						comparison.baseline.output_bytes,
					gpu_seconds: scoreDelta(
						comparison.baseline.gpu_seconds ?? undefined,
						comparison.motion_canvas.gpu_seconds ?? undefined,
					),
				},
				quality_delta: {
					visual_quality_delta: scoreDelta(
						human?.baseline.visual_quality,
						human?.motion_canvas.visual_quality,
					),
					comprehension_delta: scoreDelta(
						human?.baseline.comprehension,
						human?.motion_canvas.comprehension,
					),
					identity_consistency_delta: scoreDelta(
						human?.baseline.identity_consistency,
						human?.motion_canvas.identity_consistency,
					),
				},
				human_evaluation: human ?? null,
			};
		}),
	};
}
