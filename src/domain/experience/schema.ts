import { z } from "zod";

export const ExperienceLaneSchema = z.enum(["LIGHT", "EXPLAIN", "DEEP"]);

export const ExperienceActionSchema = z.enum([
	"rise",
	"fall",
	"inflate",
	"shrink",
	"split",
	"block",
	"connect",
	"build",
	"overflow",
	"exchange",
]);

export const ExperienceReactionSchema = z.enum([
	"happy",
	"freeze",
	"worried",
	"panic",
	"relief",
	"confused",
]);

export const ExperienceAssetStrategySchema = z.enum([
	"reuse",
	"deterministic",
	"generated",
]);

export const ExperienceContractSchema = z.object({
	lane: ExperienceLaneSchema,
	viewer_question: z.string().trim().min(1),
	visual_metaphor: z.string().trim().min(1),
	hook: z.object({
		setup: z.string().trim().min(1),
		surprise: z.string().trim().min(1),
		payoff: z.string().trim().min(1),
	}),
	visible_change: z.string().trim().min(1),
	cute_moment: z.string().trim().min(1),
	learning_goal: z.string().trim().min(1),
});

// Action is kept as a non-empty string here so the experience audit can report
// disallowed verbs with a useful path instead of failing episode parsing first.
export const ExperienceSceneFieldsSchema = z.object({
	action: z.string().trim().min(1).optional(),
	subject: z.string().trim().min(1).optional(),
	reaction: ExperienceReactionSchema.optional(),
	concept_id: z
		.string()
		.regex(/^[A-Za-z0-9_-]+$/)
		.optional(),
	asset_strategy: ExperienceAssetStrategySchema.optional(),
});

const LaneLimitSchema = z.object({
	max_concepts: z.number().int().positive(),
	max_scenes: z.number().int().positive(),
	max_generated_assets: z.number().int().nonnegative(),
});

const ExperienceIdentityMarkerSchema = z.enum([
	"existing_character_asset",
	"palette.background",
	"palette.accent_primary",
]);

const ExperienceIdentityRecognitionSchema = z
	.object({
		protocol_version: z.literal(1),
		fixed_markers: z.array(ExperienceIdentityMarkerSchema).length(3),
		frame_sample_rule: z.literal("midpoint_of_first_scene"),
		blinded_fields: z
			.array(z.enum(["channel_name", "episode_title", "captions", "audio"]))
			.length(4),
		randomized_order: z.literal(true),
		respondent_cohort: z.literal("self_reported_unfamiliar_viewers"),
		answer_options: z
			.array(
				z.enum([
					"byosan_money",
					"humanity_observatory",
					"yawa_archive",
					"not_sure",
				]),
			)
			.length(4),
		report_metrics: z
			.array(
				z.enum([
					"per_channel_top1_accuracy",
					"confusion_matrix",
					"wilson_95_percent_interval",
				]),
			)
			.length(3),
		acceptance_threshold: z.null(),
	})
	.strict()
	.superRefine((protocol, context) => {
		for (const field of [
			"fixed_markers",
			"blinded_fields",
			"answer_options",
			"report_metrics",
		] as const) {
			if (new Set(protocol[field]).size !== protocol[field].length) {
				context.addIssue({
					code: "custom",
					path: [field],
					message: `${field} must not contain duplicates`,
				});
			}
		}
	});

export const ExperienceProfileSchema = z.object({
	schema_version: z.literal(1),
	channel: z.literal("byosan_money"),
	action_vocabulary: z.array(ExperienceActionSchema).min(1),
	forbidden_actions: z.array(z.string().trim().min(1)).min(1),
	lane_limits: z.object({
		LIGHT: LaneLimitSchema,
		EXPLAIN: LaneLimitSchema,
		DEEP: LaneLimitSchema,
	}),
});

export const ExperienceWorldSchema = z
	.object({
		schema_version: z.literal(1),
		channel: z.literal("byosan_money"),
		identity: z.object({
			character: z.string().trim().min(1),
			reuse_existing_asset: z.boolean(),
			single_frame_recognition: ExperienceIdentityRecognitionSchema,
		}),
		palette: z.record(
			z.string().regex(/^[a-z][a-z0-9_]*$/),
			z.string().regex(/^#[0-9a-fA-F]{6}$/),
		),
		visual_vocabulary: z
			.array(
				z.object({
					id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
					metaphor: z.string().trim().min(1),
					action: ExperienceActionSchema,
				}),
			)
			.min(10),
	})
	.superRefine((world, context) => {
		const fixedMarkers = world.identity.single_frame_recognition.fixed_markers;
		if (
			fixedMarkers.includes("existing_character_asset") &&
			!world.identity.reuse_existing_asset
		) {
			context.addIssue({
				code: "custom",
				path: ["identity", "single_frame_recognition", "fixed_markers"],
				message:
					"existing_character_asset requires identity.reuse_existing_asset",
			});
		}
		for (const [index, marker] of fixedMarkers.entries()) {
			if (
				marker.startsWith("palette.") &&
				!Object.hasOwn(world.palette, marker.slice("palette.".length))
			) {
				context.addIssue({
					code: "custom",
					path: [
						"identity",
						"single_frame_recognition",
						"fixed_markers",
						index,
					],
					message: `fixed frame marker ${marker} is missing from the palette`,
				});
			}
		}
	});

export const ExperienceRenderVisualSchema = ExperienceSceneFieldsSchema.extend({
	type: z.string().trim().min(1),
	props: z.record(z.string(), z.unknown()),
});

export const ExperienceRenderItemSchema = z.object({
	id: z.string().regex(/^[A-Za-z0-9_-]+$/),
	startFrame: z.number().int().nonnegative(),
	endFrame: z.number().int().positive(),
	speaker: z.string().trim().min(1),
	text: z.string().min(1),
	subtitle: z.string().min(1),
	shortRole: z.enum(["HOOK", "HIGHLIGHT", "CTA"]).nullable(),
	visual: ExperienceRenderVisualSchema,
});

export const ExperienceRenderInputSchema = z
	.object({
		fps: z.number().int().min(1).max(120),
		width: z.number().int().positive(),
		height: z.number().int().positive(),
		durationInFrames: z.number().int().positive(),
		items: z.array(ExperienceRenderItemSchema).min(1),
	})
	.superRefine((input, context) => {
		const seen = new Set<string>();
		for (const [index, item] of input.items.entries()) {
			if (seen.has(item.id)) {
				context.addIssue({
					code: "custom",
					path: ["items", index, "id"],
					message: `duplicate render item id: ${item.id}`,
				});
			}
			seen.add(item.id);
			if (item.endFrame <= item.startFrame) {
				context.addIssue({
					code: "custom",
					path: ["items", index, "endFrame"],
					message: "endFrame must be after startFrame",
				});
			}
			if (item.endFrame > input.durationInFrames) {
				context.addIssue({
					code: "custom",
					path: ["items", index, "endFrame"],
					message: "render item exceeds durationInFrames",
				});
			}
		}
	});

export const CANONICAL_EXPERIENCE_SCENE_IDS = [
	"dividend-coin-rain",
	"per-balloon",
	"covered-call-tether",
	"drawdown-floor",
	"capex-capacity",
] as const;

export const ExperienceBenchmarkSchema =
	ExperienceRenderInputSchema.superRefine((input, context) => {
		if (input.items.length !== CANONICAL_EXPERIENCE_SCENE_IDS.length) {
			context.addIssue({
				code: "custom",
				path: ["items"],
				message: `benchmark must contain exactly ${CANONICAL_EXPERIENCE_SCENE_IDS.length} canonical scenes`,
			});
		}
		for (const [
			index,
			expectedId,
		] of CANONICAL_EXPERIENCE_SCENE_IDS.entries()) {
			if (input.items[index]?.id !== expectedId) {
				context.addIssue({
					code: "custom",
					path: ["items", index, "id"],
					message: `canonical scene ${index + 1} must be ${expectedId}`,
				});
			}
		}
	});

export type ExperienceContract = z.infer<typeof ExperienceContractSchema>;
export type ExperienceLane = z.infer<typeof ExperienceLaneSchema>;
export type ExperienceAction = z.infer<typeof ExperienceActionSchema>;
export type ExperienceReaction = z.infer<typeof ExperienceReactionSchema>;
export type ExperienceAssetStrategy = z.infer<
	typeof ExperienceAssetStrategySchema
>;
export type ExperienceSceneFields = z.infer<typeof ExperienceSceneFieldsSchema>;
export type ExperienceProfile = z.infer<typeof ExperienceProfileSchema>;
export type ExperienceWorld = z.infer<typeof ExperienceWorldSchema>;
export type ExperienceIdentityRecognition = z.infer<
	typeof ExperienceIdentityRecognitionSchema
>;
export type ExperienceRenderInput = z.infer<typeof ExperienceRenderInputSchema>;
export type ExperienceRenderItem = z.infer<typeof ExperienceRenderItemSchema>;
export type ExperienceBenchmark = z.infer<typeof ExperienceBenchmarkSchema>;

export function parseExperienceBenchmark(text: string): ExperienceBenchmark {
	return ExperienceBenchmarkSchema.parse(JSON.parse(text));
}
