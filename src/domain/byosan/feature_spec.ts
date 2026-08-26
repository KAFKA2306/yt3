import { z } from "zod";

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

export const ByosanFeatureSegmentSchema = z.object({
	chapter: z.string().min(1).max(40).optional(),
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
	claim: z.string().min(8),
	sourceIds: z.array(z.string().min(1)).min(1),
	status: z.enum([
		"verified",
		"derived_with_caveat",
		"analyst_estimate_not_company_non_gaap",
	]),
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
	noveltyQueries: z.array(z.string().min(8).max(180)).min(2).max(5),
	tags: z.array(z.string().min(1).max(30)).min(5).max(15),
	sources: z.array(ByosanFeatureSourceSchema).min(2).max(12),
	claims: z.array(ByosanFeatureClaimSchema).min(3).max(18),
	segments: z.array(ByosanFeatureSegmentSchema).min(20).max(32),
});

export const ByosanFeatureDraftSchema = ByosanFeatureSpecSchema.omit({
	schemaVersion: true,
	runId: true,
	asOf: true,
	angle: true,
	searchQuery: true,
	sources: true,
});

export type ByosanFeatureSpec = z.infer<typeof ByosanFeatureSpecSchema>;
export type ByosanFeatureDraft = z.infer<typeof ByosanFeatureDraftSchema>;
export type ByosanFeatureSegment = z.infer<typeof ByosanFeatureSegmentSchema>;
export type ByosanFeatureSource = z.infer<typeof ByosanFeatureSourceSchema>;
export type ByosanStatColor = z.infer<typeof ByosanStatColorSchema>;

export type FeatureSpecIssue = {
	code: string;
	details: string;
};

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
