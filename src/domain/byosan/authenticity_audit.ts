import { z } from "zod";
import type { Explanation } from "./explanation.js";
import type { ByosanFeatureSpec } from "./feature_spec.js";
import {
	ByosanSceneKindSchema,
	type ByosanSceneSpec,
	ByosanScenesConfigSchema,
} from "./scene_spec.js";

const ByosanAuthenticityConfigSchema = z
	.object({
		history_window: z.number().int().positive(),
		max_similarity: z.number().min(0).max(1),
		max_generic_ratio: z.number().min(0).max(1),
		generic_kinds: z.array(ByosanSceneKindSchema).min(1),
		scene_claim_statuses: z.array(z.string().min(1)).min(1),
		independent_work: z
			.object({
				verification_roles: z.array(z.string().min(1)).min(1),
				comparison_kinds: z.array(ByosanSceneKindSchema).min(1),
				scenes_per_figure: z.number().int().positive(),
			})
			.strict(),
	})
	.strict();

export const ByosanAuthenticityAuditConfigSchema = z
	.object({
		scenes: ByosanScenesConfigSchema,
		authenticity: ByosanAuthenticityConfigSchema,
	})
	.strict();

export type ByosanAuthenticityAuditConfig = z.infer<
	typeof ByosanAuthenticityAuditConfigSchema
>;

export type ByosanPreviousRun = {
	asOf: string;
	sequence: string[];
};

type ByosanAuthenticityIssue = {
	code: string;
	details: string;
};

type ByosanAuthenticityResult = {
	status: "PASS" | "FAIL";
	metrics: {
		distinct_kinds: number;
		max_consecutive_same_kind: number;
		generic_ratio: number;
		comparison_scenes: number;
		comparison_scenes_required: number;
		verification_sequence_found: boolean;
		claims_total: number;
		claims_displayed: number;
		third_party_reference_scenes: number;
		max_history_similarity: number | null;
	};
	violations: ByosanAuthenticityIssue[];
	warnings: ByosanAuthenticityIssue[];
};

type AuthenticityInput = {
	scenes: ByosanSceneSpec[];
	featureSpec: Pick<ByosanFeatureSpec, "claims" | "segments" | "sources">;
	explanation: Pick<Explanation, "figures">;
	previousRuns: ByosanPreviousRun[];
	config: ByosanAuthenticityAuditConfig;
};

function longestRun(kinds: string[]): number {
	let longest = 0;
	let run = 0;
	for (const [index, kind] of kinds.entries()) {
		run = kinds[index - 1] === kind ? run + 1 : 1;
		longest = Math.max(longest, run);
	}
	return longest;
}

function editDistance(
	left: readonly string[],
	right: readonly string[],
): number {
	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (const [leftIndex, leftItem] of left.entries()) {
		const current = [leftIndex + 1];
		for (const [rightIndex, rightItem] of right.entries()) {
			current.push(
				Math.min(
					(current[rightIndex] ?? 0) + 1,
					(previous[rightIndex + 1] ?? 0) + 1,
					(previous[rightIndex] ?? 0) + (leftItem === rightItem ? 0 : 1),
				),
			);
		}
		previous = current;
	}
	return previous[right.length] ?? 0;
}

function sequenceSimilarity(
	left: readonly string[],
	right: readonly string[],
): number {
	const longest = Math.max(left.length, right.length);
	if (longest === 0) return 1;
	return 1 - editDistance(left, right) / longest;
}

function hasRoleSequence(
	segments: ByosanFeatureSpec["segments"],
	roles: string[],
): boolean {
	let cursor = -1;
	for (const role of roles) {
		const index = segments.findIndex(
			(segment, candidate) =>
				candidate > cursor && segment.verificationRole === role,
		);
		if (index < 0) return false;
		cursor = index;
	}
	return true;
}

export function auditAuthenticity(
	input: AuthenticityInput,
): ByosanAuthenticityResult {
	const { scenes: sceneConfig, authenticity } = input.config;
	const { scenes, featureSpec, explanation } = input;
	const segments = featureSpec.segments;
	const violations: ByosanAuthenticityIssue[] = [];
	const warnings: ByosanAuthenticityIssue[] = [];

	const kinds = scenes.map((scene) => scene.visual.kind);
	const distinctKinds = new Set(kinds).size;
	if (distinctKinds < sceneConfig.min_distinct_kinds) {
		warnings.push({
			code: "distinct_kinds_too_few",
			details: `${distinctKinds}<${sceneConfig.min_distinct_kinds}`,
		});
	}
	if (scenes.length > sceneConfig.max_scenes) {
		warnings.push({
			code: "scene_count_exceeds_max",
			details: `${scenes.length}>${sceneConfig.max_scenes}`,
		});
	}

	const maxRun = longestRun(kinds);
	if (maxRun > sceneConfig.max_consecutive_same_kind) {
		warnings.push({
			code: "consecutive_same_kind_exceeded",
			details: `${maxRun}>${sceneConfig.max_consecutive_same_kind}`,
		});
	}

	const numbersOverflow = scenes.filter((scene) => {
		const visual = scene.visual;
		const refs =
			visual.kind === "question"
				? 0
				: visual.kind === "bignumber"
					? 1
					: visual.items.length;
		return refs > sceneConfig.max_numbers_per_scene;
	});
	if (numbersOverflow.length > 0) {
		warnings.push({
			code: "numbers_per_scene_exceeded",
			details: numbersOverflow.map((scene) => scene.sceneId).join(","),
		});
	}

	const genericCount = kinds.filter((kind) =>
		authenticity.generic_kinds.includes(kind),
	).length;
	const genericRatio = scenes.length === 0 ? 1 : genericCount / scenes.length;
	if (genericRatio > authenticity.max_generic_ratio) {
		warnings.push({
			code: "generic_ratio_exceeded",
			details: `${genericRatio.toFixed(3)}>${authenticity.max_generic_ratio}`,
		});
	}

	const verifiedClaimIds = new Set(
		featureSpec.claims.flatMap((claim) =>
			claim.id && authenticity.scene_claim_statuses.includes(claim.status)
				? [claim.id]
				: [],
		),
	);
	const unverifiedScenes = scenes.filter(
		(scene) =>
			scene.claimIds.length === 0 ||
			scene.claimIds.some((claimId) => !verifiedClaimIds.has(claimId)),
	);
	if (unverifiedScenes.length > 0) {
		violations.push({
			code: "scene_claim_unverified",
			details: unverifiedScenes.map((scene) => scene.sceneId).join(","),
		});
	}

	const independent = authenticity.independent_work;
	const verificationSequenceFound = hasRoleSequence(
		segments,
		independent.verification_roles,
	);
	if (!verificationSequenceFound) {
		warnings.push({
			code: "verification_sequence_missing",
			details: independent.verification_roles.join(">"),
		});
	}
	const comparisonScenes = scenes.filter((scene) =>
		independent.comparison_kinds.includes(scene.visual.kind),
	).length;
	const comparisonRequired =
		explanation.figures.length * independent.scenes_per_figure;
	if (comparisonScenes < comparisonRequired) {
		warnings.push({
			code: "comparison_scenes_short",
			details: `${comparisonScenes}<${comparisonRequired}`,
		});
	}

	const sourceNames = new Map(
		featureSpec.sources.map((source) => [
			source.id,
			source.name.split(/[：:]/u)[0]?.trim() ?? source.name,
		]),
	);
	const undisplayedClaims = featureSpec.claims.filter(
		(claim) =>
			segments.some((segment) =>
				(segment.claimIds ?? []).includes(claim.id ?? ""),
			) &&
			!segments.some(
				(segment) =>
					claim.id !== undefined &&
					(segment.claimIds ?? []).includes(claim.id) &&
					claim.sourceIds.some((sourceId) => {
						const name = sourceNames.get(sourceId);
						return name !== undefined && segment.source.includes(name);
					}),
			),
	);
	if (undisplayedClaims.length > 0) {
		violations.push({
			code: "claim_source_not_displayed",
			details: undisplayedClaims.map((claim) => claim.id ?? "").join(","),
		});
	}

	const thirdPartyScenes = scenes.filter((scene) =>
		/https?:\/\//.test(JSON.stringify(scene)),
	);
	if (thirdPartyScenes.length > 0) {
		violations.push({
			code: "third_party_reference",
			details: thirdPartyScenes.map((scene) => scene.sceneId).join(","),
		});
	}

	const currentSequence = segments.map((segment) => segment.visualType);
	const history = [...input.previousRuns]
		.sort((left, right) => right.asOf.localeCompare(left.asOf))
		.slice(0, authenticity.history_window)
		.map((run) => ({
			asOf: run.asOf,
			similarity: sequenceSimilarity(currentSequence, run.sequence),
		}));
	for (const run of history) {
		if (run.similarity > authenticity.max_similarity) {
			warnings.push({
				code: "history_similarity_exceeded",
				details: `${run.asOf}:${run.similarity.toFixed(3)}>${authenticity.max_similarity}`,
			});
		}
	}

	return {
		status: violations.length === 0 ? "PASS" : "FAIL",
		metrics: {
			distinct_kinds: distinctKinds,
			max_consecutive_same_kind: maxRun,
			generic_ratio: genericRatio,
			comparison_scenes: comparisonScenes,
			comparison_scenes_required: comparisonRequired,
			verification_sequence_found: verificationSequenceFound,
			claims_total: featureSpec.claims.length,
			claims_displayed: featureSpec.claims.length - undisplayedClaims.length,
			third_party_reference_scenes: thirdPartyScenes.length,
			max_history_similarity:
				history.length === 0
					? null
					: Math.max(...history.map((run) => run.similarity)),
		},
		violations,
		warnings,
	};
}
