import { z } from "zod";
import { CANONICAL_EXPERIENCE_SCENE_IDS } from "./schema.js";

const SCORE_DIMENSIONS = [
	"visual_quality",
	"comprehension",
	"identity_consistency",
	"entertainment",
	"character_cuteness",
	"enjoyment",
] as const;

const SCORE_DELTA_FIELDS = {
	visual_quality: "visual_quality_delta",
	comprehension: "comprehension_delta",
	identity_consistency: "identity_consistency_delta",
	entertainment: "entertainment_delta",
	character_cuteness: "character_cuteness_delta",
	enjoyment: "enjoyment_delta",
} as const;

export const EXPERIENCE_HUMAN_REVIEW_RUBRIC = {
	rating_scale:
		"1=very weak, 2=weak, 3=mixed/adequate, 4=strong, 5=very strong",
	instructions:
		"Rate each renderer independently for every dimension. Do not average dimensions; no overall score is computed.",
	dimensions: {
		visual_quality: "Visual clarity, composition, and polish",
		comprehension: "How easily the intended concept is understood",
		identity_consistency: "Consistency of character and channel identity",
		entertainment: "How interesting or amusing the scene is",
		character_cuteness: "Perceived cuteness of the character",
		enjoyment: "Overall enjoyment of watching the scene",
	},
} as const;

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const RatingSchema = z.number().int().min(1).max(5);
const SceneIdSchema = z.enum(CANONICAL_EXPERIENCE_SCENE_IDS);
const ReviewRubricSchema = z
	.object({
		rating_scale: z.literal(EXPERIENCE_HUMAN_REVIEW_RUBRIC.rating_scale),
		instructions: z.literal(EXPERIENCE_HUMAN_REVIEW_RUBRIC.instructions),
		dimensions: z
			.object({
				visual_quality: z.literal(
					EXPERIENCE_HUMAN_REVIEW_RUBRIC.dimensions.visual_quality,
				),
				comprehension: z.literal(
					EXPERIENCE_HUMAN_REVIEW_RUBRIC.dimensions.comprehension,
				),
				identity_consistency: z.literal(
					EXPERIENCE_HUMAN_REVIEW_RUBRIC.dimensions.identity_consistency,
				),
				entertainment: z.literal(
					EXPERIENCE_HUMAN_REVIEW_RUBRIC.dimensions.entertainment,
				),
				character_cuteness: z.literal(
					EXPERIENCE_HUMAN_REVIEW_RUBRIC.dimensions.character_cuteness,
				),
				enjoyment: z.literal(
					EXPERIENCE_HUMAN_REVIEW_RUBRIC.dimensions.enjoyment,
				),
			})
			.strict(),
	})
	.strict();

export const ExperienceHumanReviewScoresSchema = z
	.object({
		visual_quality: RatingSchema,
		comprehension: RatingSchema,
		identity_consistency: RatingSchema,
		entertainment: RatingSchema,
		character_cuteness: RatingSchema,
		enjoyment: RatingSchema,
	})
	.strict();

const ReviewSceneSchema = z
	.object({
		scene_id: SceneIdSchema,
		baseline_video_path: z.string().trim().min(1),
		baseline_output_sha256: HashSchema,
		motion_canvas_video_path: z.string().trim().min(1),
		motion_canvas_output_sha256: HashSchema,
		baseline: ExperienceHumanReviewScoresSchema,
		motion_canvas: ExperienceHumanReviewScoresSchema,
		notes: z.string().trim().max(4000).optional(),
	})
	.strict();

const BenchmarkSceneSchema = z
	.object({
		scene_id: SceneIdSchema,
		baseline_video_path: z.string().trim().min(1),
		baseline_output_sha256: HashSchema,
		motion_canvas_video_path: z.string().trim().min(1),
		motion_canvas_output_sha256: HashSchema,
	})
	.strict();

function requireCanonicalSceneOrder(
	scenes: Array<{ scene_id: string }>,
	context: z.RefinementCtx,
): void {
	for (const [index, expected] of CANONICAL_EXPERIENCE_SCENE_IDS.entries()) {
		if (scenes[index]?.scene_id !== expected) {
			context.addIssue({
				code: "custom",
				path: ["scenes", index, "scene_id"],
				message: `canonical scene ${index + 1} must be ${expected}`,
			});
		}
	}
}

export const ExperienceHumanReviewSchema = z
	.object({
		schema_version: z.literal(1),
		rubric_version: z.literal(1),
		rubric: ReviewRubricSchema,
		benchmark_run_id: z.string().trim().min(1),
		reviewer: z.string().trim().min(1),
		reviewed_at: z.string().datetime(),
		scenes: z
			.array(ReviewSceneSchema)
			.length(CANONICAL_EXPERIENCE_SCENE_IDS.length),
	})
	.strict()
	.superRefine((review, context) =>
		requireCanonicalSceneOrder(review.scenes, context),
	);

export const ExperienceHumanReviewBenchmarkSchema = z
	.object({
		benchmark_run_id: z.string().trim().min(1),
		scenes: z
			.array(BenchmarkSceneSchema)
			.length(CANONICAL_EXPERIENCE_SCENE_IDS.length),
	})
	.strict()
	.superRefine((benchmark, context) => {
		requireCanonicalSceneOrder(benchmark.scenes, context);
		for (const [index, scene] of benchmark.scenes.entries()) {
			const expectedBaseline = `scenes/${scene.scene_id}/baseline/render.mp4`;
			const expectedMotionCanvas = `scenes/${scene.scene_id}/motion-canvas/render.mp4`;
			if (scene.baseline_video_path !== expectedBaseline) {
				context.addIssue({
					code: "custom",
					path: ["scenes", index, "baseline_video_path"],
					message: `baseline video path must be ${expectedBaseline}`,
				});
			}
			if (scene.motion_canvas_video_path !== expectedMotionCanvas) {
				context.addIssue({
					code: "custom",
					path: ["scenes", index, "motion_canvas_video_path"],
					message: `Motion Canvas video path must be ${expectedMotionCanvas}`,
				});
			}
		}
	});

export type ExperienceHumanReview = z.infer<typeof ExperienceHumanReviewSchema>;
export type ExperienceHumanReviewBenchmark = z.infer<
	typeof ExperienceHumanReviewBenchmarkSchema
>;
export type ExperienceHumanReviewScores = z.infer<
	typeof ExperienceHumanReviewScoresSchema
>;

export interface ExperienceHumanReviewTemplate {
	schema_version: 1;
	rubric_version: 1;
	rubric: typeof EXPERIENCE_HUMAN_REVIEW_RUBRIC;
	benchmark_run_id: string;
	reviewer: "";
	reviewed_at: "";
	scenes: Array<{
		scene_id: (typeof CANONICAL_EXPERIENCE_SCENE_IDS)[number];
		baseline_video_path: string;
		baseline_output_sha256: string;
		motion_canvas_video_path: string;
		motion_canvas_output_sha256: string;
		baseline: Record<(typeof SCORE_DIMENSIONS)[number], null>;
		motion_canvas: Record<(typeof SCORE_DIMENSIONS)[number], null>;
		notes: "";
	}>;
}

export function buildExperienceHumanReviewTemplate(
	input: unknown,
): ExperienceHumanReviewTemplate {
	const benchmark = ExperienceHumanReviewBenchmarkSchema.parse(input);
	const emptyScores = Object.fromEntries(
		SCORE_DIMENSIONS.map((dimension) => [dimension, null]),
	) as Record<(typeof SCORE_DIMENSIONS)[number], null>;

	return {
		schema_version: 1,
		rubric_version: 1,
		rubric: EXPERIENCE_HUMAN_REVIEW_RUBRIC,
		benchmark_run_id: benchmark.benchmark_run_id,
		reviewer: "",
		reviewed_at: "",
		scenes: benchmark.scenes.map((scene) => ({
			...scene,
			baseline: { ...emptyScores },
			motion_canvas: { ...emptyScores },
			notes: "",
		})),
	};
}

export interface ExperienceHumanReviewReport {
	schema_version: 1;
	status: "HUMAN_REVIEW_REPORTED";
	reviewer_identity_status: "SELF_REPORTED";
	rubric_version: 1;
	benchmark_run_id: string;
	reviewer: string;
	reviewed_at: string;
	scenes: Array<{
		scene_id: (typeof CANONICAL_EXPERIENCE_SCENE_IDS)[number];
		artifacts: {
			baseline: { video_path: string; output_sha256: string };
			motion_canvas: { video_path: string; output_sha256: string };
		};
		baseline: ExperienceHumanReviewScores;
		motion_canvas: ExperienceHumanReviewScores;
		quality_delta: Record<
			(typeof SCORE_DELTA_FIELDS)[keyof typeof SCORE_DELTA_FIELDS],
			number
		>;
		notes?: string;
	}>;
}

export function auditExperienceHumanReview(
	reviewInput: unknown,
	benchmarkInput: unknown,
): ExperienceHumanReviewReport {
	const review = ExperienceHumanReviewSchema.parse(reviewInput);
	const benchmark = ExperienceHumanReviewBenchmarkSchema.parse(benchmarkInput);
	if (review.benchmark_run_id !== benchmark.benchmark_run_id) {
		throw new Error("benchmark run does not match the submitted review");
	}

	const scenes = review.scenes.map((scene, index) => {
		const expected = benchmark.scenes[index];
		if (!expected || scene.scene_id !== expected.scene_id) {
			throw new Error("review scene does not match the benchmark");
		}
		if (
			scene.baseline_video_path !== expected.baseline_video_path ||
			scene.motion_canvas_video_path !== expected.motion_canvas_video_path
		) {
			throw new Error(`artifact path does not match for ${scene.scene_id}`);
		}
		if (
			scene.baseline_output_sha256 !== expected.baseline_output_sha256 ||
			scene.motion_canvas_output_sha256 !== expected.motion_canvas_output_sha256
		) {
			throw new Error(`artifact hash does not match for ${scene.scene_id}`);
		}

		const qualityDelta = Object.fromEntries(
			SCORE_DIMENSIONS.map((dimension) => [
				SCORE_DELTA_FIELDS[dimension],
				scene.motion_canvas[dimension] - scene.baseline[dimension],
			]),
		) as ExperienceHumanReviewReport["scenes"][number]["quality_delta"];

		return {
			scene_id: scene.scene_id,
			artifacts: {
				baseline: {
					video_path: scene.baseline_video_path,
					output_sha256: scene.baseline_output_sha256,
				},
				motion_canvas: {
					video_path: scene.motion_canvas_video_path,
					output_sha256: scene.motion_canvas_output_sha256,
				},
			},
			baseline: scene.baseline,
			motion_canvas: scene.motion_canvas,
			quality_delta: qualityDelta,
			...(scene.notes ? { notes: scene.notes } : {}),
		};
	});

	return {
		schema_version: 1,
		status: "HUMAN_REVIEW_REPORTED",
		reviewer_identity_status: "SELF_REPORTED",
		rubric_version: 1,
		benchmark_run_id: review.benchmark_run_id,
		reviewer: review.reviewer.trim(),
		reviewed_at: review.reviewed_at,
		scenes,
	};
}
