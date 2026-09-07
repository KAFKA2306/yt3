import { createHash } from "node:crypto";
import { z } from "zod";
import {
	type ByosanFeatureSpec,
	ByosanFeatureClaimSchema,
	ByosanFeatureSourceSchema,
	ByosanFeatureSpecSchema,
	ByosanNarrativeRoleSchema,
	ByosanNarrativeSchema,
	ByosanVerificationRoleSchema,
	auditByosanFeatureSpec,
} from "./feature_spec.js";
import { ByosanProductionPlanSchema } from "./news_angle.js";

export const ByosanContentAnchorSegmentSchema = z.object({
	index: z.number().int().min(0),
	narrativeRole: ByosanNarrativeRoleSchema.optional(),
	verificationRole: ByosanVerificationRoleSchema.optional(),
	archetypeSlot: z.string().regex(/^[a-z0-9_]+$/).optional(),
	claimIds: z.array(z.string().min(1)).max(6).optional(),
	evidenceIds: z.array(z.string().min(1)).max(6).optional(),
	text: z.string().min(18).max(180),
});

export const ByosanContentAnchorSchema = z.object({
	schemaVersion: z.literal("byosan_content_anchor_v1"),
	runId: z.string().min(1),
	asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	angle: z.string().min(8),
	production: ByosanProductionPlanSchema.optional(),
	narrative: ByosanNarrativeSchema.optional(),
	sources: z.array(ByosanFeatureSourceSchema).min(2),
	claims: z.array(ByosanFeatureClaimSchema).min(3),
	segments: z.array(ByosanContentAnchorSegmentSchema).min(1),
});

export const ByosanPresentationSkinSchema = z.object({
	schemaVersion: z.literal("byosan_presentation_skin_v1"),
	surface: z.enum(["youtube_feature", "youtube_shorts", "x_video"]),
	layout: z.string().min(1).max(80),
	aspectRatio: z.string().regex(/^\d+:\d+$/),
	captionStyle: z.string().min(1).max(80),
	voiceByRole: z.object({
		presenter: z.string().min(1).max(80),
		auditor: z.string().min(1).max(80),
		resolution: z.string().min(1).max(80),
		landing: z.string().min(1).max(80),
	}),
	segmentIndexes: z.array(z.number().int().min(0)).min(1).max(36).optional(),
});

export const ByosanPresentationVariantSchema = z.object({
	schemaVersion: z.literal("byosan_presentation_variant_v1"),
	contentAnchorHash: z.string().regex(/^[a-f0-9]{64}$/),
	skin: ByosanPresentationSkinSchema,
	segmentRenderPlan: z.array(
		z.object({
			anchorSegmentIndex: z.number().int().min(0),
			voice: z.string().min(1).max(80),
		}),
	),
});

export type ByosanContentAnchor = z.infer<typeof ByosanContentAnchorSchema>;
export type ByosanPresentationSkin = z.infer<typeof ByosanPresentationSkinSchema>;
export type ByosanPresentationVariant = z.infer<
	typeof ByosanPresentationVariantSchema
>;

export type ByosanPresentationVariantIssue = {
	code: string;
	details: string;
};

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, canonicalize(child)]),
		);
	}
	return value;
}

export function hashByosanContentAnchor(anchorInput: ByosanContentAnchor): string {
	const anchor = ByosanContentAnchorSchema.parse(anchorInput);
	return createHash("sha256")
		.update(JSON.stringify(canonicalize(anchor)))
		.digest("hex");
}

export function buildByosanContentAnchor(
	specInput: ByosanFeatureSpec,
): ByosanContentAnchor {
	const spec = ByosanFeatureSpecSchema.parse(specInput);
	const auditIssues = auditByosanFeatureSpec(spec);
	if (auditIssues.length > 0) {
		throw new Error(
			`BYOSAN_CONTENT_ANCHOR_SOURCE_NOT_AUDITED:${auditIssues
				.map((issue) => issue.code)
				.join(",")}`,
		);
	}
	return ByosanContentAnchorSchema.parse({
		schemaVersion: "byosan_content_anchor_v1",
		runId: spec.runId,
		asOf: spec.asOf,
		angle: spec.angle,
		...(spec.production ? { production: spec.production } : {}),
		...(spec.narrative ? { narrative: spec.narrative } : {}),
		sources: spec.sources,
		claims: spec.claims,
		segments: spec.segments.map((segment, index) => ({
			index,
			...(segment.narrativeRole
				? { narrativeRole: segment.narrativeRole }
				: {}),
			...(segment.verificationRole
				? { verificationRole: segment.verificationRole }
				: {}),
			...(segment.archetypeSlot
				? { archetypeSlot: segment.archetypeSlot }
				: {}),
			...(segment.claimIds ? { claimIds: segment.claimIds } : {}),
			...(segment.evidenceIds ? { evidenceIds: segment.evidenceIds } : {}),
			text: segment.text,
		})),
	});
}

function expectedSegmentIndexes(
	anchor: ByosanContentAnchor,
	skin: ByosanPresentationSkin,
): number[] {
	if (!skin.segmentIndexes) return anchor.segments.map((segment) => segment.index);
	const indexes = [...skin.segmentIndexes];
	if (new Set(indexes).size !== indexes.length) {
		throw new Error("BYOSAN_PRESENTATION_SKIN_DUPLICATE_SEGMENT_INDEX");
	}
	if (indexes.some((index) => !anchor.segments.some((segment) => segment.index === index))) {
		throw new Error("BYOSAN_PRESENTATION_SKIN_UNKNOWN_SEGMENT_INDEX");
	}
	if (indexes.some((index, position) => position > 0 && index <= (indexes[position - 1] ?? -1))) {
		throw new Error("BYOSAN_PRESENTATION_SKIN_SEGMENT_ORDER_INVALID");
	}
	return indexes;
}

function voiceForSegment(
	segment: ByosanContentAnchor["segments"][number],
	skin: ByosanPresentationSkin,
): string {
	const role = segment.verificationRole ?? "presenter";
	return skin.voiceByRole[role];
}

export function buildByosanPresentationVariant(
	anchorInput: ByosanContentAnchor,
	skinInput: ByosanPresentationSkin,
): ByosanPresentationVariant {
	const anchor = ByosanContentAnchorSchema.parse(anchorInput);
	const skin = ByosanPresentationSkinSchema.parse(skinInput);
	const indexes = expectedSegmentIndexes(anchor, skin);
	const segmentByIndex = new Map(
		anchor.segments.map((segment) => [segment.index, segment]),
	);
	return ByosanPresentationVariantSchema.parse({
		schemaVersion: "byosan_presentation_variant_v1",
		contentAnchorHash: hashByosanContentAnchor(anchor),
		skin,
		segmentRenderPlan: indexes.map((index) => {
			const segment = segmentByIndex.get(index);
			if (!segment) throw new Error("BYOSAN_PRESENTATION_SEGMENT_MISSING");
			return {
				anchorSegmentIndex: index,
				voice: voiceForSegment(segment, skin),
			};
		}),
	});
}

export function auditByosanPresentationVariant(
	anchorInput: ByosanContentAnchor,
	variantInput: ByosanPresentationVariant,
): ByosanPresentationVariantIssue[] {
	const anchor = ByosanContentAnchorSchema.parse(anchorInput);
	const variant = ByosanPresentationVariantSchema.parse(variantInput);
	const issues: ByosanPresentationVariantIssue[] = [];
	const expectedHash = hashByosanContentAnchor(anchor);
	if (variant.contentAnchorHash !== expectedHash) {
		issues.push({
			code: "content_anchor_hash_mismatch",
			details: `${variant.contentAnchorHash} != ${expectedHash}`,
		});
	}
	let expectedIndexes: number[] = [];
	try {
		expectedIndexes = expectedSegmentIndexes(anchor, variant.skin);
	} catch (error) {
		issues.push({
			code: "presentation_skin_segment_selection_invalid",
			details: error instanceof Error ? error.message : String(error),
		});
		return issues;
	}
	const actualIndexes = variant.segmentRenderPlan.map(
		(segment) => segment.anchorSegmentIndex,
	);
	if (JSON.stringify(actualIndexes) !== JSON.stringify(expectedIndexes)) {
		issues.push({
			code: "presentation_segment_plan_mismatch",
			details: `${actualIndexes.join(",")} != ${expectedIndexes.join(",")}`,
		});
	}
	const segmentByIndex = new Map(
		anchor.segments.map((segment) => [segment.index, segment]),
	);
	for (const rendered of variant.segmentRenderPlan) {
		const segment = segmentByIndex.get(rendered.anchorSegmentIndex);
		if (!segment) {
			issues.push({
				code: "presentation_segment_unknown",
				details: String(rendered.anchorSegmentIndex),
			});
			continue;
		}
		const expectedVoice = voiceForSegment(segment, variant.skin);
		if (rendered.voice !== expectedVoice) {
			issues.push({
				code: "presentation_voice_mismatch",
				details: `${rendered.anchorSegmentIndex}:${rendered.voice} != ${expectedVoice}`,
			});
		}
	}
	return issues;
}
