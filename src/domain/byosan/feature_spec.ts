import { z } from "zod";
import { loadConfig } from "../../io/core.js";
import { ByosanActiveProbeEvidenceSchema } from "./active_probe.js";
import { ExplanationSchema } from "./explanation.js";

export const ByosanSourceTierSchema = z.enum([
	"L1",
	"L2",
	"L3",
	"L4",
	"L5",
	"unknown",
]);

const ByosanAdversarialEvidenceSchema = z.object({
	id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
	kind: z.enum([
		"measurement_condition",
		"counter_metric",
		"third_party_disagreement",
		"source_limitation",
		"no_counter_evidence",
	]),
	targetClaim: z.string().min(1),
	statement: z.string().min(1),
	sourceIds: z.array(z.string().min(1)).min(1),
	checkedSourceIds: z.array(z.string().min(1)).min(1),
});

export const ByosanProductionFormatSchema = z.enum([
	"breaking",
	"comparison",
	"deep_dive",
	"regular",
]);

const ByosanProductionPlanSchema = z.object({
	format: ByosanProductionFormatSchema,
	targetMinutes: z.number(),
	minSegments: z.number().int(),
	maxSegments: z.number().int(),
	reasons: z.array(z.string().min(1)).min(1),
});

const ByosanStatColorSchema = z.enum(["cyan", "amber", "white", "muted"]);

const ByosanFeatureStatSchema = z.object({
	label: z.string().min(1),
	value: z.string().min(1).max(24),
	detail: z.string().min(1),
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

export const ByosanFeatureSegmentSchema = z.object({
	narrativeRole: ByosanNarrativeRoleSchema.optional(),
	verificationRole: ByosanVerificationRoleSchema.optional(),
	archetypeSlot: z
		.string()
		.regex(/^[a-z0-9_]+$/)
		.optional(),
	claimIds: z.array(z.string().min(1)).optional(),
	evidenceIds: z.array(z.string().min(1)).optional(),
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
	section: z.string().min(1),
	headline: z.string().min(1).max(34),
	subheadline: z.string().min(1),
	visualType: z.string().min(1),
	stats: z.array(ByosanFeatureStatSchema).max(3),
	source: z.string().min(2),
	text: z.string().min(1),
});

export const ByosanFeatureSourceSchema = z.object({
	id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
	name: z.string().min(1),
	url: z.string().url(),
	tier: ByosanSourceTierSchema.optional(),
});

export const ByosanFeatureClaimSchema = z.object({
	id: z
		.string()
		.regex(/^[a-zA-Z0-9_-]+$/)
		.optional(),
	claim: z.string().min(1),
	sourceIds: z.array(z.string().min(1)).min(1),
	status: z.enum([
		"verified",
		"derived_with_caveat",
		"analyst_estimate_not_company_non_gaap",
	]),
	assumptions: z.array(z.string().min(1)).optional(),
	caveat: z.string().min(1).optional(),
	confidence: z.number().min(0).max(1).optional(),
	unresolvedMismatches: z.array(z.string().min(1)).optional(),
	epistemicBoundary: z.string().min(1).optional(),
});

const ByosanPackagingSchema = z.object({
	primaryClaimId: z.string().min(1),
	claimIds: z.array(z.string().min(1)).min(1),
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
			comparator: z.string().min(1),
			period: z.string().min(1),
		})
		.optional(),
	impactClaimId: z.string().min(1).optional(),
});

const ByosanNarrativeSchema = z.object({
	hiddenMechanism: z.string().min(1),
	counterfactual: z.string().min(1),
	audiencePayoff: z.string().min(1),
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

export const ByosanFeatureSpecSchema = z.object({
	schemaVersion: z.literal("byosan_feature_v1"),
	runId: z.string().regex(/^byosan_money\/\d{4}-\d{2}-\d{2}[a-zA-Z0-9_-]*$/),
	asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	angle: z.string().min(1),
	searchQuery: z.string().min(1),
	title: z.string().min(1).max(100),
	thumbnailTitle: z.string().min(1),
	thumbnail: ByosanThumbnailSchema,
	descriptionLead: z.string().min(1),
	descriptionBullets: z.array(z.string().min(1)).min(1),
	disclaimer: z.string().min(1),
	hookPromises: z.array(z.string().min(1)).optional(),
	production: ByosanProductionPlanSchema.optional(),
	packaging: ByosanPackagingSchema.optional(),
	narrative: ByosanNarrativeSchema.optional(),
	adversarialEvidence: z.array(ByosanAdversarialEvidenceSchema).optional(),
	activeProbes: z.array(ByosanActiveProbeEvidenceSchema).optional(),
	noveltyQueries: z.array(z.string().min(1)).min(1),
	tags: z.array(z.string().min(1).max(30)),
	sources: z.array(ByosanFeatureSourceSchema).min(2),
	claims: z.array(ByosanFeatureClaimSchema).min(1),
	segments: z.array(ByosanFeatureSegmentSchema).min(1),
});

const BYOSAN_BRAND_TAG = "秒算マネー";

export function ensureByosanBrandTag(
	tags: readonly string[] | undefined,
): string[] {
	return [
		BYOSAN_BRAND_TAG,
		...(tags ?? []).filter((tag) => tag !== BYOSAN_BRAND_TAG),
	];
}

export const ByosanFeatureDraftSchema = ByosanFeatureSpecSchema.omit({
	schemaVersion: true,
	runId: true,
	asOf: true,
	sources: true,
	production: true,
	narrative: true,
	adversarialEvidence: true,
	activeProbes: true,
	tags: true,
}).extend({
	tags: z.array(z.string().min(1).max(30)).optional(),
	claims: z.array(
		ByosanFeatureClaimSchema.extend({
			id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
		}),
	),
	packaging: ByosanPackagingSchema,
	sources: z.array(ByosanFeatureSourceSchema.omit({ tier: true })).min(2),
	explanation: ExplanationSchema,
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

const FeatureReviewSchema = z.object({
	blocking_codes: z.array(z.string().min(1)),
});

export type FeatureReview = z.infer<typeof FeatureReviewSchema>;

export function loadFeatureReview(): FeatureReview {
	return FeatureReviewSchema.parse(
		(loadConfig("byosan_money") as unknown as { feature_review: unknown })
			.feature_review,
	);
}

export function isBlockingFeatureIssue(
	issue: FeatureSpecIssue,
	review: FeatureReview = loadFeatureReview(),
): boolean {
	return (
		issue.code.startsWith("schema_") ||
		review.blocking_codes.includes(issue.code)
	);
}

export const GLOBAL_ISSUE_PATH = "";

export function segmentIssuePath(index: number): string {
	return `segments[${index}]`;
}

export function claimIssuePath(index: number): string {
	return `claims[${index}]`;
}

function absoluteDays(left: string, right: string): number {
	const leftTimestamp = Date.parse(`${left}T00:00:00Z`);
	const rightTimestamp = Date.parse(`${right}T00:00:00Z`);
	if (!Number.isFinite(leftTimestamp) || !Number.isFinite(rightTimestamp)) {
		return Number.POSITIVE_INFINITY;
	}
	return Math.abs(leftTimestamp - rightTimestamp) / 86_400_000;
}

function packagingIssues(spec: ByosanFeatureSpec): FeatureSpecIssue[] {
	if (!spec.packaging) return [];
	const issues: FeatureSpecIssue[] = [];
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
	return issues;
}

export function auditByosanFeatureSpec(
	specInput: ByosanFeatureSpec,
): FeatureSpecIssue[] {
	const spec = ByosanFeatureSpecSchema.parse(specInput);
	const issues: FeatureSpecIssue[] = [];
	const sourceIds = new Set(spec.sources.map((source) => source.id));
	if (sourceIds.size !== spec.sources.length) {
		issues.push({
			code: "duplicate_source_id",
			details: "Source IDs must be unique",
			path: GLOBAL_ISSUE_PATH,
		});
	}
	for (const [claimIndex, claim] of spec.claims.entries()) {
		const path = claimIssuePath(claimIndex);
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
	}
	issues.push(...packagingIssues(spec));
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
	return issues;
}

export function parseAndAuditByosanFeatureSpec(
	input: unknown,
): ByosanFeatureSpec {
	const spec = ByosanFeatureSpecSchema.parse(input);
	const blocking = auditByosanFeatureSpec(spec).filter((issue) =>
		isBlockingFeatureIssue(issue),
	);
	if (blocking.length > 0) {
		throw new Error(
			`BYOSAN_FEATURE_SPEC_INVALID: ${blocking.map((issue) => `${issue.code}=${issue.details}`).join("; ")}`,
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
