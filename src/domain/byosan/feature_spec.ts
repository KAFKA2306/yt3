import { z } from "zod";
import { ByosanProductionPlanSchema } from "./news_angle.js";

export const ByosanStatColorSchema = z.enum([
	"cyan",
	"amber",
	"white",
	"muted",
]);

export const ByosanFeatureStatSchema = z.object({
	label: z.string().min(1).max(30),
	value: z.string().min(1).max(24),
	detail: z.string().min(1).max(40),
	color: ByosanStatColorSchema,
});

export const ByosanNarrativeRoleSchema = z.enum([
	"fact",
	"context",
	"impact",
	"action",
]);

export const ByosanFeatureSegmentSchema = z.object({
	chapter: z.string().min(1).max(40).optional(),
	narrativeRole: ByosanNarrativeRoleSchema.optional(),
	claimIds: z.array(z.string().min(1)).max(6).optional(),
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
	stats: z.array(ByosanFeatureStatSchema).min(1).max(3),
	source: z.string().min(2).max(80),
	text: z.string().min(18).max(180),
});

export const ByosanFeatureSourceSchema = z.object({
	id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
	name: z.string().min(2),
	url: z.string().url(),
});

export const ByosanFeatureClaimSchema = z.object({
	id: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional(),
	claim: z.string().min(8),
	sourceIds: z.array(z.string().min(1)).min(1),
	status: z.enum([
		"verified",
		"derived_with_caveat",
		"analyst_estimate_not_company_non_gaap",
	]),
	assumptions: z.array(z.string().min(3)).max(6).optional(),
	caveat: z.string().min(3).max(240).optional(),
});

export const ByosanPackagingSchema = z.object({
	primaryClaimId: z.string().min(1),
	claimIds: z.array(z.string().min(1)).min(1).max(6),
	freshness: z
		.object({
			claimId: z.string().min(1),
			eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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

export const ByosanNarrativeSchema = z.object({
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
	hookPromises: z.array(z.string().min(1).max(24)).min(2).max(4),
	production: ByosanProductionPlanSchema.optional(),
	packaging: ByosanPackagingSchema.optional(),
	narrative: ByosanNarrativeSchema.optional(),
	noveltyQueries: z.array(z.string().min(8).max(180)).min(2).max(5),
	tags: z.array(z.string().min(1).max(30)).min(5).max(15),
	sources: z.array(ByosanFeatureSourceSchema).min(2).max(12),
	claims: z.array(ByosanFeatureClaimSchema).min(3).max(18),
	segments: z.array(ByosanFeatureSegmentSchema).min(20).max(36),
});

export const ByosanFeatureDraftSchema = ByosanFeatureSpecSchema.omit({
	schemaVersion: true,
	runId: true,
	asOf: true,
	angle: true,
	searchQuery: true,
	sources: true,
	production: true,
	narrative: true,
}).extend({
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
export type ByosanFeatureDraft = z.infer<typeof ByosanFeatureDraftSchema>;
export type ByosanFeatureSegment = z.infer<typeof ByosanFeatureSegmentSchema>;
export type ByosanFeatureSource = z.infer<typeof ByosanFeatureSourceSchema>;
export type ByosanStatColor = z.infer<typeof ByosanStatColorSchema>;
export type ByosanNarrativeRole = z.infer<typeof ByosanNarrativeRoleSchema>;

export type FeatureSpecIssue = {
	code: string;
	details: string;
};

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
	if (sourceIds.size !== spec.sources.length) {
		issues.push({
			code: "duplicate_source_id",
			details: "Source IDs must be unique",
		});
	}
	for (const claim of spec.claims) {
		const missing = claim.sourceIds.filter(
			(sourceId) => !sourceIds.has(sourceId),
		);
		if (missing.length > 0) {
			issues.push({
				code: "claim_source_missing",
				details: `${claim.claim}: ${missing.join(",")}`,
			});
		}
		if (
			spec.production &&
			claim.status !== "verified" &&
			(!claim.caveat || claim.caveat.trim().length < 3)
		) {
			issues.push({
				code: "derived_claim_caveat_missing",
				details: claim.id || claim.claim,
			});
		}
	}

	if (spec.production) {
		if (
			spec.segments.length < spec.production.minSegments ||
			spec.segments.length > spec.production.maxSegments
		) {
			issues.push({
				code: "production_segment_count_out_of_range",
				details: `${spec.segments.length} not in ${spec.production.minSegments}-${spec.production.maxSegments}`,
			});
		}
		if (!spec.packaging) {
			issues.push({
				code: "packaging_contract_missing",
				details: "production-aware specs require packaging evidence",
			});
		}
		if (!spec.narrative) {
			issues.push({
				code: "narrative_contract_missing",
				details: "production-aware specs require narrative grounding",
			});
		}
	}

	if (spec.packaging) {
		const packagingIds = new Set([
			spec.packaging.primaryClaimId,
			...spec.packaging.claimIds,
			...(spec.packaging.impactClaimId
				? [spec.packaging.impactClaimId]
				: []),
			...(spec.packaging.freshness
				? [spec.packaging.freshness.claimId]
				: []),
			...(spec.packaging.relativeAnchor
				? [spec.packaging.relativeAnchor.claimId]
				: []),
		]);
		const missingPackagingClaims = [...packagingIds].filter(
			(claimId) => !claimIds.has(claimId),
		);
		if (missingPackagingClaims.length > 0) {
			issues.push({
				code: "packaging_claim_missing",
				details: missingPackagingClaims.join(","),
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
				});
			}
		}
		if (
			titleNumbers.length > 0 &&
			thumbnailNumbers.length > 0 &&
			!titleNumbers.some((number) => thumbnailNumbers.includes(number))
		) {
			issues.push({
				code: "title_thumbnail_material_claim_mismatch",
				details: "title and thumbnail share no grounded numeric anchor",
			});
		}
		if (/【速報】/.test(spec.title)) {
			if (
				!spec.packaging.freshness ||
				absoluteDays(spec.asOf, spec.packaging.freshness.eventDate) > 2
			) {
				issues.push({
					code: "freshness_marker_ungrounded",
					details: "【速報】 requires an event date within two days of asOf",
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
			});
		}
	}

	if (spec.narrative) {
		const roles = spec.segments.map((segment) => segment.narrativeRole);
		const factIndex = roles.indexOf("fact");
		const contextIndex = roles.indexOf("context");
		const impactIndexes = [
			roles.indexOf("impact"),
			roles.indexOf("action"),
		].filter((index) => index >= 0);
		const impactIndex =
			impactIndexes.length > 0 ? Math.min(...impactIndexes) : -1;
		if (
			factIndex < 0 ||
			contextIndex <= factIndex ||
			impactIndex <= contextIndex
		) {
			issues.push({
				code: "fact_context_impact_sequence_missing",
				details: "narrative requires Fact -> Context -> Impact/Action order",
			});
		}
		for (const segment of spec.segments.filter(
			(segment) => segment.narrativeRole === "fact",
		)) {
			if (!segment.claimIds || segment.claimIds.length === 0) {
				issues.push({
					code: "fact_segment_claim_missing",
					details: segment.headline,
				});
			}
		}
	}

	const opening = spec.segments
		.slice(0, 2)
		.map((segment) => segment.text)
		.join(" ");
	for (const promise of spec.hookPromises) {
		if (!opening.includes(promise)) {
			issues.push({
				code: "opening_promise_missing",
				details: `Opening does not contain ${promise}`,
			});
		}
	}
	const thumbnailText = Object.values(spec.thumbnail).join(" ");
	if (!spec.hookPromises.some((promise) => thumbnailText.includes(promise))) {
		issues.push({
			code: "thumbnail_hook_disconnected",
			details: "Thumbnail must contain at least one opening hook promise",
		});
	}
	if (new Set(spec.segments.map((segment) => segment.emotion)).size < 7) {
		issues.push({
			code: "emotion_arc_too_narrow",
			details: "At least seven emotion presets are required",
		});
	}
	if (!spec.tags.includes("秒算マネー")) {
		issues.push({
			code: "brand_tag_missing",
			details: "tags must include 秒算マネー",
		});
	}
	if (!spec.segments.some((segment) => segment.speaker === "ずんだもん")) {
		issues.push({
			code: "dialogue_missing",
			details: "ずんだもん must ask or react",
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

export function quantizedCenterOrigin(inputSize: number, zoom: number): number {
	if (!(inputSize > 0) || !(zoom >= 1)) {
		throw new Error(
			`Invalid center origin input: size=${inputSize} zoom=${zoom}`,
		);
	}
	return Math.floor((inputSize - inputSize / zoom) / 4) * 2;
}

export function centerLockedMotionFilter(fps = 30): string {
	return [
		`zoompan=z='min(max(pzoom,1)+0.0002,1.18)'`,
		"x='floor((iw-iw/zoom)/4)*2'",
		"y='floor((ih-ih/zoom)/4)*2'",
		`d=1:s=1920x1080:fps=${fps}`,
	].join(":");
}
