import { z } from "zod";
import {
	ByosanActiveProbeEvidenceSchema,
	auditByosanActiveProbeEvidence,
} from "./active_probe.js";
import { loadDialogueStyle } from "./dialogue_style.js";
import {
	ByosanEditorialReferencePlanSchema,
	auditByosanEditorialReferencePlan,
	editorialReferenceIds,
	isByosanEditorialReferenceId,
} from "./editorial_references.js";
import { figuresIn } from "./explanation_contract.js";
import {
	type ByosanNarrativeArchetype,
	requiredByosanArchetypeSlots,
} from "./narrative_archetype.js";
import {
	ByosanAdversarialEvidenceSchema,
	ByosanProductionPlanSchema,
	ByosanSourceTierSchema,
} from "./news_angle.js";
import type { ByosanScenesConfig } from "./scene_spec.js";

const ByosanStatColorSchema = z.enum(["cyan", "amber", "white", "muted"]);

const ByosanFeatureStatSchema = z.object({
	label: z.string().min(1).max(30),
	value: z.string().min(1).max(24),
	detail: z.string().min(1).max(40),
	color: ByosanStatColorSchema,
});

const ByosanNarrativeRoleSchema = z.enum([
	"fact",
	"context",
	"impact",
	"action",
]);

const ByosanVerificationRoleSchema = z.enum([
	"presenter",
	"auditor",
	"resolution",
	"landing",
]);

/**
 * Prompt rule for segments[].archetypeSlot, derived from the same slot list
 * that the archetype audit enforces (requiredByosanArchetypeSlots).
 */
export function archetypeSlotPromptPolicy(
	narrativeArchetype: ByosanNarrativeArchetype | undefined,
): string {
	const slots = requiredByosanArchetypeSlots(narrativeArchetype ?? "standard");
	if (slots.length === 0) {
		return "segments[].archetypeSlot は出力しないでください。この format は専用 archetype を使わないため、値を入れると検証で却下されます。";
	}
	return `segments[].archetypeSlot は次の値だけを使い、この順番で各1回以上、segments の順序を保って出してください: ${slots.join(", ")}。それ以外の値は検証で却下されます。`;
}

export const SEGMENT_CLAIM_IDS_MAX = 6;

export const ByosanFeatureSegmentSchema = z.object({
	narrativeRole: ByosanNarrativeRoleSchema.optional(),
	verificationRole: ByosanVerificationRoleSchema.optional(),
	archetypeSlot: z
		.string()
		.regex(/^[a-z0-9_]+$/)
		.optional(),
	claimIds: z.array(z.string().min(1)).max(SEGMENT_CLAIM_IDS_MAX).optional(),
	evidenceIds: z.array(z.string().min(1)).max(6).optional(),
	speaker: z.enum(["春日部つむぎ", "ずんだもん"]),
	emotion: z.enum([
		"shock",
		"reveal",
		"curious",
		"analytical",
		"caution",
		"confident",
		"warm",
		"relieved",
		"serious",
		"joy",
	]),
	section: z.string().min(2).max(44),
	headline: z.string().min(2).max(34),
	subheadline: z.string().min(2).max(52),
	visualType: z.string().min(2).max(30),
	stats: z.array(ByosanFeatureStatSchema).min(0).max(3),
	source: z.string().min(2).max(80),
	text: z.string().min(18).max(180),
});

export const ByosanFeatureSourceSchema = z.object({
	id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
	name: z.string().min(2),
	url: z.string().url(),
	tier: ByosanSourceTierSchema.optional(),
});

export const ByosanFeatureClaimSchema = z.object({
	id: z
		.string()
		.regex(/^[a-zA-Z0-9_-]+$/)
		.optional(),
	claim: z.string().min(8),
	sourceIds: z.array(z.string().min(1)).min(1),
	status: z.enum([
		"verified",
		"derived_with_caveat",
		"analyst_estimate_not_company_non_gaap",
	]),
	assumptions: z.array(z.string().min(3)).max(6).optional(),
	caveat: z.string().min(3).max(240).optional(),
	confidence: z.number().min(0).max(1).optional(),
	unresolvedMismatches: z.array(z.string().min(5).max(180)).max(6).optional(),
	epistemicBoundary: z.string().min(8).max(180).optional(),
});

const ByosanPackagingSchema = z.object({
	primaryClaimId: z.string().min(1),
	claimIds: z.array(z.string().min(1)).min(1).max(6),
	freshness: z
		.object({
			claimId: z.string().min(1),
			eventDate: z
				.string()
				.regex(/^\d{4}-\d{2}-\d{2}$/)
				.describe("YYYY-MM-DD 形式の日付（例: 2026-10-24）"),
		})
		.optional(),
	relativeAnchor: z
		.object({
			claimId: z.string().min(1),
			comparator: z.string().min(2).max(80),
			period: z.string().min(2).max(80),
		})
		.optional(),
	impactClaimId: z.string().min(1).optional(),
});

const ByosanNarrativeSchema = z.object({
	hiddenMechanism: z.string().min(12),
	counterfactual: z.string().min(12),
	audiencePayoff: z.string().min(8),
});

export const ByosanThumbnailSchema = z.object({
	eyebrow: z.string().min(2).max(18),
	lead: z.string().min(1).max(8),
	accent: z.string().min(1).max(10),
	reaction: z.string().min(1).max(4),
	secondLine: z.string().min(2).max(12),
	calloutTop: z.string().min(2).max(22),
	calloutBottom: z.string().min(2).max(18),
});

export const HOOK_PROMISE_MAX_CHARS = 24;

export const ByosanFeatureSpecSchema = z.object({
	schemaVersion: z.literal("byosan_feature_v1"),
	runId: z.string().regex(/^byosan_money\/\d{4}-\d{2}-\d{2}[a-zA-Z0-9_-]*$/),
	asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	angle: z.string().min(12),
	searchQuery: z.string().min(5),
	title: z.string().min(10).max(100),
	thumbnailTitle: z.string().min(4).max(42),
	thumbnail: ByosanThumbnailSchema,
	descriptionLead: z.string().min(30).max(500),
	descriptionBullets: z.array(z.string().min(8).max(180)).min(3).max(8),
	disclaimer: z.string().min(20).max(400),
	hookPromises: z
		.array(z.string().min(1).max(HOOK_PROMISE_MAX_CHARS))
		.min(2)
		.max(4),
	production: ByosanProductionPlanSchema.optional(),
	editorialReferencePlan: ByosanEditorialReferencePlanSchema.optional(),
	packaging: ByosanPackagingSchema.optional(),
	narrative: ByosanNarrativeSchema.optional(),
	adversarialEvidence: z
		.array(ByosanAdversarialEvidenceSchema)
		.min(1)
		.max(10)
		.optional(),
	activeProbes: z.array(ByosanActiveProbeEvidenceSchema).max(8).optional(),
	noveltyQueries: z.array(z.string().min(8).max(180)).min(2).max(5),
	tags: z.array(z.string().min(1).max(30)).min(5).max(15),
	sources: z.array(ByosanFeatureSourceSchema).min(2).max(12),
	claims: z.array(ByosanFeatureClaimSchema).min(3).max(18),
	segments: z.array(ByosanFeatureSegmentSchema).min(20).max(36),
});

const BYOSAN_BRAND_TAG = "秒算マネー";

export function ensureByosanBrandTag(
	tags: readonly string[] | undefined,
): string[] {
	return [
		BYOSAN_BRAND_TAG,
		...(tags ?? []).filter((tag) => tag !== BYOSAN_BRAND_TAG),
	].slice(0, 15);
}

export const ByosanFeatureDraftSchema = ByosanFeatureSpecSchema.omit({
	schemaVersion: true,
	runId: true,
	asOf: true,
	angle: true,
	searchQuery: true,
	sources: true,
	production: true,
	narrative: true,
	adversarialEvidence: true,
	activeProbes: true,
	tags: true,
}).extend({
	hookPromises: z.array(z.string().min(1)).min(2).max(4),
	tags: z.array(z.string().min(1).max(30)).min(4).max(14).optional(),
	claims: z
		.array(
			ByosanFeatureClaimSchema.extend({
				id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
			}),
		)
		.min(3)
		.max(18),
	packaging: ByosanPackagingSchema,
});

export type ByosanFeatureSpec = z.infer<typeof ByosanFeatureSpecSchema>;
export type ByosanFeatureSegment = z.infer<typeof ByosanFeatureSegmentSchema>;
export type ByosanFeatureSource = z.infer<typeof ByosanFeatureSourceSchema>;
export type ByosanStatColor = z.infer<typeof ByosanStatColorSchema>;
export type ByosanNarrativeRole = z.infer<typeof ByosanNarrativeRoleSchema>;

export type FeatureSpecIssue = {
	code: string;
	details: string;
	path: string;
};

export const GLOBAL_ISSUE_PATH = "";

export function segmentIssuePath(index: number): string {
	return `segments[${index}]`;
}

export function claimIssuePath(index: number): string {
	return `claims[${index}]`;
}

function numericTokens(value: string): string[] {
	return Array.from(
		new Set(
			value
				.normalize("NFKC")
				.match(/\d+(?:[.,]\d+)*/g)
				?.map((token) => token.replaceAll(",", "")) ?? [],
		),
	);
}

function absoluteDays(left: string, right: string): number {
	const leftTimestamp = Date.parse(`${left}T00:00:00Z`);
	const rightTimestamp = Date.parse(`${right}T00:00:00Z`);
	if (!Number.isFinite(leftTimestamp) || !Number.isFinite(rightTimestamp)) {
		return Number.POSITIVE_INFINITY;
	}
	return Math.abs(leftTimestamp - rightTimestamp) / 86_400_000;
}

export function auditByosanFeatureSpec(
	specInput: ByosanFeatureSpec,
): FeatureSpecIssue[] {
	const spec = ByosanFeatureSpecSchema.parse(specInput);
	const issues: FeatureSpecIssue[] = [];
	const sourceIds = new Set(spec.sources.map((source) => source.id));
	const claimIds = new Set(
		spec.claims.flatMap((claim) => (claim.id ? [claim.id] : [])),
	);
	if (spec.editorialReferencePlan) {
		auditByosanEditorialReferencePlan(spec.editorialReferencePlan);
		const overlapping = [
			...editorialReferenceIds(spec.editorialReferencePlan),
		].filter((id) => sourceIds.has(id));
		if (overlapping.length > 0) {
			issues.push({
				code: "editorial_reference_source_namespace_overlap",
				details: overlapping.join(","),
				path: GLOBAL_ISSUE_PATH,
			});
		}
	}
	if (sourceIds.size !== spec.sources.length) {
		issues.push({
			code: "duplicate_source_id",
			details: "Source IDs must be unique",
			path: GLOBAL_ISSUE_PATH,
		});
	}
	for (const [claimIndex, claim] of spec.claims.entries()) {
		const path = claimIssuePath(claimIndex);
		const editorialSourceIds = claim.sourceIds.filter(
			isByosanEditorialReferenceId,
		);
		if (editorialSourceIds.length > 0) {
			issues.push({
				code: "editorial_reference_used_as_fact_source",
				details: `${claim.claim}: ${editorialSourceIds.join(",")}`,
				path,
			});
		}
		const missing = claim.sourceIds.filter(
			(sourceId) => !sourceIds.has(sourceId),
		);
		if (missing.length > 0) {
			issues.push({
				code: "claim_source_missing",
				details: `${claim.claim}: ${missing.join(",")}`,
				path,
			});
		}
		if (spec.production && claim.status !== "verified") {
			if (!claim.caveat || claim.caveat.trim().length < 3) {
				issues.push({
					code: "derived_claim_caveat_missing",
					details: claim.id || claim.claim,
					path,
				});
			}
			if (claim.confidence === undefined) {
				issues.push({
					code: "inference_confidence_missing",
					details: claim.id || claim.claim,
					path,
				});
			}
			if (claim.unresolvedMismatches === undefined) {
				issues.push({
					code: "inference_mismatch_review_missing",
					details: claim.id || claim.claim,
					path,
				});
			}
		}
	}

	if (spec.production) {
		if (!spec.packaging) {
			issues.push({
				code: "packaging_contract_missing",
				details: "production-aware specs require packaging evidence",
				path: "packaging",
			});
		}
		if (!spec.narrative) {
			issues.push({
				code: "narrative_contract_missing",
				details: "production-aware specs require narrative grounding",
				path: GLOBAL_ISSUE_PATH,
			});
		}
		if (!spec.adversarialEvidence) {
			issues.push({
				code: "adversarial_evidence_contract_missing",
				details: "production-aware specs require research adversarial evidence",
				path: GLOBAL_ISSUE_PATH,
			});
		}
	}

	if (spec.packaging) {
		const packagingIds = new Set([
			spec.packaging.primaryClaimId,
			...spec.packaging.claimIds,
			...(spec.packaging.impactClaimId ? [spec.packaging.impactClaimId] : []),
			...(spec.packaging.freshness ? [spec.packaging.freshness.claimId] : []),
			...(spec.packaging.relativeAnchor
				? [spec.packaging.relativeAnchor.claimId]
				: []),
		]);
		const primaryClaim = spec.claims.find(
			(claim) => claim.id === spec.packaging?.primaryClaimId,
		);
		if (primaryClaim && figuresIn(primaryClaim.claim).length === 0) {
			issues.push({
				code: "packaging_primary_claim_without_figure",
				details: primaryClaim.id ?? primaryClaim.claim,
				path: "packaging.primaryClaimId",
			});
		}
		const missingPackagingClaims = [...packagingIds].filter(
			(claimId) => !claimIds.has(claimId),
		);
		if (missingPackagingClaims.length > 0) {
			issues.push({
				code: "packaging_claim_missing",
				details: missingPackagingClaims.join(","),
				path: "packaging",
			});
		}

		const packagingClaims = spec.claims.filter(
			(claim) => claim.id && packagingIds.has(claim.id),
		);
		const supportedText = packagingClaims.map((claim) => claim.claim).join(" ");
		const titleNumbers = numericTokens(spec.title);
		const thumbnailNumbers = numericTokens(
			[spec.thumbnailTitle, ...Object.values(spec.thumbnail)].join(" "),
		);
		for (const number of new Set([...titleNumbers, ...thumbnailNumbers])) {
			if (!numericTokens(supportedText).includes(number)) {
				issues.push({
					code: "packaging_number_ungrounded",
					details: number,
					path: titleNumbers.includes(number) ? "title" : "thumbnailTitle",
				});
			}
		}
		if (/【速報】/.test(spec.title)) {
			if (
				!spec.packaging.freshness ||
				absoluteDays(spec.asOf, spec.packaging.freshness.eventDate) > 2
			) {
				issues.push({
					code: "freshness_marker_ungrounded",
					details: "【速報】 requires an event date within two days of asOf",
					path: "title",
				});
			}
		}
		if (
			/(最大|最安|最高|最低|急騰|急落|崩壊|級)/.test(
				`${spec.title} ${spec.thumbnailTitle}`,
			) &&
			!spec.packaging.relativeAnchor
		) {
			issues.push({
				code: "relative_claim_ungrounded",
				details: "comparative/extreme wording requires comparator and period",
				path: "title",
			});
		}
	}

	if (spec.activeProbes) {
		for (const probe of spec.activeProbes) {
			for (const issue of auditByosanActiveProbeEvidence(probe)) {
				issues.push({
					code: `active_probe_${issue.code}`,
					details: issue.details,
					path: "activeProbes",
				});
			}
			const missing = probe.sourceIds.filter(
				(sourceId) => !sourceIds.has(sourceId),
			);
			if (missing.length > 0) {
				issues.push({
					code: "active_probe_source_missing",
					details: `${probe.id}: ${missing.join(",")}`,
					path: "activeProbes",
				});
			}
		}
	}

	if (spec.adversarialEvidence) {
		const evidenceIds = new Set(
			spec.adversarialEvidence.map((evidence) => evidence.id),
		);
		for (const evidence of spec.adversarialEvidence) {
			const missing = [
				...evidence.sourceIds,
				...evidence.checkedSourceIds,
			].filter((sourceId) => !sourceIds.has(sourceId));
			if (missing.length > 0) {
				issues.push({
					code: "adversarial_evidence_source_missing",
					details: `${evidence.id}: ${[...new Set(missing)].join(",")}`,
					path: GLOBAL_ISSUE_PATH,
				});
			}
		}
		for (const [segmentIndex, segment] of spec.segments.entries()) {
			const missingEvidenceIds = (segment.evidenceIds ?? []).filter(
				(evidenceId) => !evidenceIds.has(evidenceId),
			);
			if (missingEvidenceIds.length > 0) {
				issues.push({
					code: "segment_adversarial_evidence_missing",
					details: `${segment.headline}: ${missingEvidenceIds.join(",")}`,
					path: segmentIssuePath(segmentIndex),
				});
			}
		}
	}

	if (spec.production && spec.packaging && spec.adversarialEvidence) {
		const sourceById = new Map(
			spec.sources.map((source) => [source.id, source]),
		);
		for (const [claimIndex, claim] of spec.claims.entries()) {
			if (!claim.id || claim.epistemicBoundary) continue;
			const claimSources = claim.sourceIds
				.map((sourceId) => sourceById.get(sourceId))
				.filter((source): source is NonNullable<typeof source> =>
					Boolean(source),
				);
			const vendorOnly =
				claimSources.length > 0 &&
				claimSources.every((source) => source.tier === "L3");
			if (vendorOnly) {
				issues.push({
					code: "vendor_claim_boundary_missing",
					details: claim.id,
					path: claimIssuePath(claimIndex),
				});
			}
		}
	}

	const openingClaimIds = new Set(
		spec.segments.slice(0, 2).flatMap((segment) => segment.claimIds ?? []),
	);
	if (
		spec.packaging &&
		!spec.packaging.claimIds.some((claimId) => openingClaimIds.has(claimId))
	) {
		issues.push({
			code: "packaging_claim_not_in_opening",
			details: spec.packaging.claimIds.join(","),
			path: segmentIssuePath(0),
		});
	}
	const memoTerms = loadDialogueStyle().targets.production_memo_terms;
	for (const [segmentIndex, segment] of spec.segments.entries()) {
		const term = memoTerms.find((memo) => segment.text.includes(memo));
		if (term) {
			issues.push({
				code: "production_memo_in_dialogue",
				details: term,
				path: segmentIssuePath(segmentIndex),
			});
		}
	}
	if (!spec.tags.includes(BYOSAN_BRAND_TAG)) {
		issues.push({
			code: "brand_tag_missing",
			details: `tags must include ${BYOSAN_BRAND_TAG}`,
			path: "tags",
		});
	}
	if (!spec.segments.some((segment) => segment.speaker === "ずんだもん")) {
		issues.push({
			code: "dialogue_missing",
			details: "ずんだもん must ask or react",
			path: GLOBAL_ISSUE_PATH,
		});
	}
	return issues;
}

export function parseAndAuditByosanFeatureSpec(
	input: unknown,
): ByosanFeatureSpec {
	const spec = ByosanFeatureSpecSchema.parse(input);
	const issues = auditByosanFeatureSpec(spec);
	if (issues.length > 0) {
		throw new Error(
			`BYOSAN_FEATURE_SPEC_INVALID: ${issues.map((issue) => `${issue.code}=${issue.details}`).join("; ")}`,
		);
	}
	return spec;
}

export function staticSceneMotionFilter(fps = 30): string {
	if (!Number.isInteger(fps) || fps <= 0) {
		throw new Error(`Invalid static scene fps: ${fps}`);
	}
	return `fps=${fps}`;
}

export function buildByosanSceneRule(
	scenes: ByosanScenesConfig,
	maxGenericRatio: number,
): string {
	return `画面の種類は${scenes.min_distinct_kinds}種類以上にし、同じ種類の場面は${scenes.max_consecutive_same_kind}つまでしか続けないでください。statsは場面あたり最大${scenes.max_numbers_per_scene}件です。同じ単位の2〜3個の数値を並べて比べる場面（例: 同じ指標の別の対象、前年同月と今月など期の異なる同一指標）を、動画の中に複数入れてください。その数値は explanation の figures の value と candidateNumbers の範囲に限ります。1つの数字を大きく見せる場面はstatsを1件だけにします。数値カードのない場面（問い・つなぎ・結論・出典整理）はstatsを空にし、全場面に対する割合を${Math.round(maxGenericRatio * 100)}%以下に収めてください。その場面は連続させないでください。数値を示せる発話は数値カードの場面にし、数値カードのない場面を増やさないでください。出典を示すclaimは、そのclaimのsourceIdsに対応するsourcesのnameを略さず、そのclaimを参照するsegmentのsourceに含めてください。そのclaimの区別（確認済み・派生値・推計のいずれか）も同じsourceに含めてください。`;
}
