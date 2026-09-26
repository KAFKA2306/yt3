import { z } from "zod";
import type { Episode } from "../episode/schema.js";
import type { ExperienceProfile } from "./schema.js";

export interface ExperienceAuditIssue {
	code: string;
	path: string;
	message: string;
}

const MetricValueSchema = z.number().finite().nonnegative().nullable();

export const ExperienceRendererMetricsSchema = z.object({
	schema_version: z.literal(1),
	engine: z.enum(["remotion-existing", "motion-canvas"]),
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
	source_lines_changed: z.number().int().nonnegative().nullable(),
	custom_code_lines: z.number().int().nonnegative().nullable(),
	dependency_lock_bytes: z.number().int().positive().nullable(),
	output_bytes: z.number().int().positive(),
	output_sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export type ExperienceRendererMetrics = z.infer<
	typeof ExperienceRendererMetricsSchema
>;

export interface RendererMetricsInput {
	engine: ExperienceRendererMetrics["engine"];
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
	return ExperienceRendererMetricsSchema.parse({
		schema_version: 1,
		...input,
		production_seconds: (finishedAt - startedAt) / 1000,
		render_seconds: input.render_seconds ?? (finishedAt - startedAt) / 1000,
		gpu_seconds: null,
		manual_fix_count: null,
		regeneration_count: null,
		new_asset_count: input.new_asset_count ?? null,
		reused_asset_count: input.reused_asset_count ?? null,
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

export function auditExperienceEpisode(
	episode: Episode,
	profile: ExperienceProfile,
): ExperienceAuditIssue[] {
	const issues: ExperienceAuditIssue[] = [];
	const experience = episode.experience;
	if (!experience) {
		issues.push({
			code: "experience_missing",
			path: "experience",
			message: "byosan episodes require an Experience Contract",
		});
	} else {
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

	for (const visual of episode.visuals) {
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
	const generatedAssets = episode.visuals.filter(
		(visual) => visual.asset_strategy === "generated",
	).length;

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
