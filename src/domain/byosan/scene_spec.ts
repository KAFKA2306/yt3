import { z } from "zod";
import type { Explanation } from "./explanation.js";
import type {
	ByosanFeatureSegment,
	ByosanFeatureSpec,
} from "./feature_spec.js";

export const ByosanSceneKindSchema = z.enum([
	"bignumber",
	"hbar_compare",
	"bar_trend",
	"line_series",
	"stat_cards",
	"question",
]);

const ByosanSceneEmphasisTypeSchema = z.enum(["reveal", "highlight", "none"]);

const ByosanSceneValueRefSchema = z.discriminatedUnion("source", [
	z.object({
		source: z.literal("stat"),
		segmentIndex: z.number().int().min(0),
		statIndex: z.number().int().min(0),
	}),
	z.object({
		source: z.literal("figure"),
		figureIndex: z.number().int().min(0),
	}),
]);

const ByosanSceneItemSchema = z.object({
	label: z.string().min(1),
	value: ByosanSceneValueRefSchema,
});

const ByosanSceneVisualSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("bignumber"),
		label: z.string().min(1),
		value: ByosanSceneValueRefSchema,
	}),
	z.object({
		kind: z.literal("hbar_compare"),
		items: z.array(ByosanSceneItemSchema).min(2),
	}),
	z.object({
		kind: z.literal("bar_trend"),
		items: z.array(ByosanSceneItemSchema).min(2),
	}),
	z.object({
		kind: z.literal("line_series"),
		items: z.array(ByosanSceneItemSchema).min(3),
	}),
	z.object({
		kind: z.literal("stat_cards"),
		items: z.array(ByosanSceneItemSchema).min(1),
	}),
	z.object({
		kind: z.literal("question"),
		prompt: z.string().min(1),
	}),
]);

const ByosanSceneSpecSchema = z.object({
	sceneId: z.string().regex(/^[a-z0-9_]+$/),
	segmentIndexes: z.array(z.number().int().min(0)).min(1),
	understandingGoal: z.string().min(1),
	claimIds: z.array(z.string().min(1)).min(1),
	visual: ByosanSceneVisualSchema,
	emphasis: z.object({
		type: ByosanSceneEmphasisTypeSchema,
		target: z.string().min(1).optional(),
	}),
	durationHint: z.number().int().positive(),
});

const ByosanSceneConditionSchema = z
	.object({
		visual_type_in: z.array(z.string().min(1)).min(1).optional(),
		stat_count_min: z.number().int().min(0).optional(),
		stat_count_max: z.number().int().min(0).optional(),
		shared_unit: z.boolean().optional(),
		figure_count_min: z.number().int().min(0).optional(),
		figures_cover_stats: z.boolean().optional(),
		numeric_values: z.boolean().optional(),
		distinct_periods_min: z.number().int().min(0).optional(),
		distinct_metrics_max: z.number().int().min(0).optional(),
	})
	.strict();

export const ByosanScenesConfigSchema = z
	.object({
		max_scenes: z.number().int().positive(),
		max_numbers_per_scene: z.number().int().positive(),
		max_consecutive_same_kind: z.number().int().positive(),
		min_distinct_kinds: z.number().int().positive(),
		chars_per_second: z.number().positive(),
		rules: z
			.array(
				z
					.object({
						kind: ByosanSceneKindSchema,
						emphasis: ByosanSceneEmphasisTypeSchema,
						when: ByosanSceneConditionSchema,
					})
					.strict(),
			)
			.min(1),
	})
	.strict();

export type ByosanSceneKind = z.infer<typeof ByosanSceneKindSchema>;
export type ByosanSceneValueRef = z.infer<typeof ByosanSceneValueRefSchema>;
export type ByosanSceneItem = z.infer<typeof ByosanSceneItemSchema>;
export type ByosanSceneVisual = z.infer<typeof ByosanSceneVisualSchema>;
export type ByosanSceneSpec = z.infer<typeof ByosanSceneSpecSchema>;
export type ByosanScenesConfig = z.infer<typeof ByosanScenesConfigSchema>;
type ByosanSceneCondition = z.infer<typeof ByosanSceneConditionSchema>;

type ByosanSceneIssue = {
	code: string;
	details: string;
};

type SceneSourceSpec = Pick<ByosanFeatureSpec, "claims" | "segments">;
type SceneExplanation = Pick<Explanation, "figures">;
type SceneFigure = Explanation["figures"][number];

type SegmentFeatures = {
	visualType: string;
	statCount: number;
	sharedUnit: boolean;
	figureCount: number;
	figuresCoverStats: boolean;
	numericValues: boolean;
	distinctPeriods: number;
	distinctMetrics: number;
};

const normalizeValue = (value: string): string =>
	value.normalize("NFKC").replace(/\s+/g, "");

const unitOf = (value: string): string =>
	normalizeValue(value).replace(/[0-9.,+\-−]/g, "");

function figureIndexOf(figures: SceneFigure[], value: string): number {
	const normalized = normalizeValue(value);
	return figures.findIndex(
		(figure) => normalizeValue(figure.value) === normalized,
	);
}

function segmentFeatures(
	segment: ByosanFeatureSegment,
	figures: SceneFigure[],
): SegmentFeatures {
	const matched = figures.filter((figure) =>
		segment.stats.some(
			(stat) => normalizeValue(stat.value) === normalizeValue(figure.value),
		),
	);
	return {
		visualType: segment.visualType,
		statCount: segment.stats.length,
		sharedUnit:
			new Set(segment.stats.map((stat) => unitOf(stat.value))).size === 1,
		figureCount: matched.length,
		figuresCoverStats: segment.stats.every(
			(stat) => figureIndexOf(figures, stat.value) >= 0,
		),
		numericValues: segment.stats.every((stat) =>
			/^[+\-−]?\d/u.test(normalizeValue(stat.value)),
		),
		distinctPeriods: new Set(matched.map((figure) => figure.period)).size,
		distinctMetrics: new Set(matched.map((figure) => figure.metric)).size,
	};
}

function matchesCondition(
	when: ByosanSceneCondition,
	features: SegmentFeatures,
): boolean {
	return [
		when.visual_type_in === undefined ||
			when.visual_type_in.includes(features.visualType),
		when.stat_count_min === undefined ||
			features.statCount >= when.stat_count_min,
		when.stat_count_max === undefined ||
			features.statCount <= when.stat_count_max,
		when.shared_unit === undefined || features.sharedUnit === when.shared_unit,
		when.figure_count_min === undefined ||
			features.figureCount >= when.figure_count_min,
		when.figures_cover_stats === undefined ||
			features.figuresCoverStats === when.figures_cover_stats,
		when.numeric_values === undefined ||
			features.numericValues === when.numeric_values,
		when.distinct_periods_min === undefined ||
			features.distinctPeriods >= when.distinct_periods_min,
		when.distinct_metrics_max === undefined ||
			features.distinctMetrics <= when.distinct_metrics_max,
	].every(Boolean);
}

function periodSeries(
	segment: ByosanFeatureSegment,
	figures: SceneFigure[],
): ByosanSceneItem[] {
	return segment.stats.map((stat) => {
		const figureIndex = figureIndexOf(figures, stat.value);
		const figure = figures[figureIndex];
		if (!figure) {
			throw new Error(
				`BYOSAN_SCENE_FIGURE_MISSING: ${stat.label} ${stat.value}`,
			);
		}
		return {
			label: figure.period,
			value: { source: "figure" as const, figureIndex },
		};
	});
}

function sceneVisual(
	kind: ByosanSceneKind,
	segment: ByosanFeatureSegment,
	segmentIndex: number,
	figures: SceneFigure[],
): ByosanSceneVisual {
	const statItems = segment.stats.map((stat, statIndex) => ({
		label: stat.label,
		value: { source: "stat" as const, segmentIndex, statIndex },
	}));
	switch (kind) {
		case "question":
			return { kind, prompt: segment.subheadline };
		case "bignumber": {
			const [only] = statItems;
			if (!only) {
				throw new Error(
					`BYOSAN_SCENE_UNASSIGNABLE: bignumber needs a stat at segment ${segmentIndex}`,
				);
			}
			return { kind, label: only.label, value: only.value };
		}
		case "hbar_compare":
			return { kind, items: statItems };
		case "stat_cards":
			return { kind, items: statItems };
		case "bar_trend":
			return { kind, items: periodSeries(segment, figures) };
		case "line_series":
			return { kind, items: periodSeries(segment, figures) };
	}
}

function compileScene(
	segment: ByosanFeatureSegment,
	segmentIndex: number,
	explanation: SceneExplanation,
	config: ByosanScenesConfig,
): ByosanSceneSpec {
	const features = segmentFeatures(segment, explanation.figures);
	const rule = config.rules.find((candidate) =>
		matchesCondition(candidate.when, features),
	);
	if (!rule) {
		throw new Error(
			`BYOSAN_SCENE_UNASSIGNABLE: segment ${segmentIndex} ${JSON.stringify(features)}`,
		);
	}
	if (!segment.claimIds || segment.claimIds.length === 0) {
		throw new Error(`BYOSAN_SCENE_CLAIM_MISSING: segment ${segmentIndex}`);
	}
	return ByosanSceneSpecSchema.parse({
		sceneId: `scene_${String(segmentIndex).padStart(2, "0")}`,
		segmentIndexes: [segmentIndex],
		understandingGoal: segment.headline,
		claimIds: segment.claimIds,
		visual: sceneVisual(rule.kind, segment, segmentIndex, explanation.figures),
		emphasis: { type: rule.emphasis },
		durationHint: Math.ceil(segment.text.length / config.chars_per_second),
	});
}

export function compileScenes(
	featureSpec: SceneSourceSpec,
	explanation: SceneExplanation,
	config: ByosanScenesConfig,
): ByosanSceneSpec[] {
	const scenes = featureSpec.segments.map((segment, segmentIndex) =>
		compileScene(segment, segmentIndex, explanation, config),
	);
	if (scenes.length > config.max_scenes) {
		throw new Error(
			`BYOSAN_SCENE_COUNT_EXCEEDED: ${scenes.length} > ${config.max_scenes}`,
		);
	}
	return scenes;
}

function visualRefs(visual: ByosanSceneVisual): ByosanSceneValueRef[] {
	if (visual.kind === "question") return [];
	if (visual.kind === "bignumber") return [visual.value];
	return visual.items.map((item) => item.value);
}

function valueRefResolves(
	ref: ByosanSceneValueRef,
	featureSpec: SceneSourceSpec,
	explanation: SceneExplanation,
): boolean {
	if (ref.source === "stat") {
		return (
			featureSpec.segments[ref.segmentIndex]?.stats[ref.statIndex] !== undefined
		);
	}
	return explanation.figures[ref.figureIndex] !== undefined;
}

function consecutiveKindIssues(
	scenes: ByosanSceneSpec[],
	limit: number,
): ByosanSceneIssue[] {
	const issues: ByosanSceneIssue[] = [];
	let run = 0;
	for (const [index, scene] of scenes.entries()) {
		run = scenes[index - 1]?.visual.kind === scene.visual.kind ? run + 1 : 1;
		if (run > limit) {
			issues.push({
				code: "consecutive_same_kind",
				details: `${scene.sceneId}:${scene.visual.kind}:${run}`,
			});
		}
	}
	return issues;
}

export function auditScenes(
	sceneInputs: ByosanSceneSpec[],
	featureSpec: SceneSourceSpec,
	explanation: SceneExplanation,
	config: ByosanScenesConfig,
): ByosanSceneIssue[] {
	const scenes = z.array(ByosanSceneSpecSchema).parse(sceneInputs);
	const issues: ByosanSceneIssue[] = [];
	if (scenes.length > config.max_scenes) {
		issues.push({
			code: "scene_count_exceeds_max",
			details: `${scenes.length}>${config.max_scenes}`,
		});
	}
	const coveredSegments = scenes.flatMap((scene) => scene.segmentIndexes);
	const expectedSegments = featureSpec.segments.map((_, index) => index);
	if (coveredSegments.join(",") !== expectedSegments.join(",")) {
		issues.push({
			code: "segment_coverage_mismatch",
			details: coveredSegments.join(","),
		});
	}
	const sceneIds = scenes.map((scene) => scene.sceneId);
	if (new Set(sceneIds).size !== sceneIds.length) {
		issues.push({ code: "scene_id_duplicate", details: sceneIds.join(",") });
	}
	const claimIds = new Set(
		featureSpec.claims.flatMap((claim) => (claim.id ? [claim.id] : [])),
	);
	for (const scene of scenes) {
		const missingClaims = scene.claimIds.filter((id) => !claimIds.has(id));
		if (missingClaims.length > 0) {
			issues.push({
				code: "claim_missing",
				details: `${scene.sceneId}:${missingClaims.join(",")}`,
			});
		}
		const refs = visualRefs(scene.visual);
		if (refs.length > config.max_numbers_per_scene) {
			issues.push({
				code: "numbers_per_scene_exceeded",
				details: `${scene.sceneId}:${refs.length}`,
			});
		}
		for (const ref of refs) {
			if (!valueRefResolves(ref, featureSpec, explanation)) {
				issues.push({
					code: "value_ref_missing",
					details: `${scene.sceneId}:${JSON.stringify(ref)}`,
				});
			}
		}
	}
	issues.push(
		...consecutiveKindIssues(scenes, config.max_consecutive_same_kind),
	);
	const distinctKinds = new Set(scenes.map((scene) => scene.visual.kind));
	if (distinctKinds.size < config.min_distinct_kinds) {
		issues.push({
			code: "distinct_kinds_too_few",
			details: `${distinctKinds.size}<${config.min_distinct_kinds}`,
		});
	}
	return issues;
}
