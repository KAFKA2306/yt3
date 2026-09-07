import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import {
	type ByosanPresentationSkin,
	auditByosanPresentationVariant,
	buildByosanContentAnchor,
	buildByosanPresentationVariant,
	hashByosanContentAnchor,
} from "../src/domain/byosan/content_variants.js";
import {
	type ByosanFeatureSpec,
	ByosanFeatureSpecSchema,
} from "../src/domain/byosan/feature_spec.js";

function referenceSpec(): ByosanFeatureSpec {
	return ByosanFeatureSpecSchema.parse(
		fs.readJsonSync("config/productions/sp500_anthropic_2026q2.json"),
	);
}

function skin(
	surface: ByosanPresentationSkin["surface"],
): ByosanPresentationSkin {
	return {
		schemaVersion: "byosan_presentation_skin_v1",
		surface,
		layout: surface === "youtube_shorts" ? "vertical_center" : "feature_center",
		aspectRatio: surface === "youtube_shorts" ? "9:16" : "16:9",
		captionStyle: "byosan_default",
		voiceByRole: {
			presenter: "春日部つむぎ",
			auditor: "ずんだもん",
			resolution: "春日部つむぎ",
			landing: "春日部つむぎ",
		},
	};
}

describe("byosan content anchor and presentation skin", () => {
	test("two presentation skins reuse the exact same audited content anchor", () => {
		const anchor = buildByosanContentAnchor(referenceSpec());
		const feature = buildByosanPresentationVariant(
			anchor,
			skin("youtube_feature"),
		);
		const shorts = buildByosanPresentationVariant(anchor, {
			...skin("youtube_shorts"),
			segmentIndexes: [0, 1, 2],
		});

		expect(feature.contentAnchorHash).toBe(hashByosanContentAnchor(anchor));
		expect(shorts.contentAnchorHash).toBe(feature.contentAnchorHash);
		expect(feature.skin.aspectRatio).toBe("16:9");
		expect(shorts.skin.aspectRatio).toBe("9:16");
		expect(
			shorts.segmentRenderPlan.map((item) => item.anchorSegmentIndex),
		).toEqual([0, 1, 2]);
		expect(auditByosanPresentationVariant(anchor, feature)).toEqual([]);
		expect(auditByosanPresentationVariant(anchor, shorts)).toEqual([]);
	});

	test("same anchor and skin produce deterministic variant output", () => {
		const anchor = buildByosanContentAnchor(referenceSpec());
		const selectedSkin = skin("x_video");
		const left = buildByosanPresentationVariant(anchor, selectedSkin);
		const right = buildByosanPresentationVariant(anchor, selectedSkin);
		expect(left).toEqual(right);
	});

	test("presentation skin cannot cherry-pick duplicate or reordered segments", () => {
		const anchor = buildByosanContentAnchor(referenceSpec());
		expect(() =>
			buildByosanPresentationVariant(anchor, {
				...skin("youtube_shorts"),
				segmentIndexes: [0, 0, 1],
			}),
		).toThrow("BYOSAN_PRESENTATION_SKIN_DUPLICATE_SEGMENT_INDEX");
		expect(() =>
			buildByosanPresentationVariant(anchor, {
				...skin("youtube_shorts"),
				segmentIndexes: [2, 1, 0],
			}),
		).toThrow("BYOSAN_PRESENTATION_SKIN_SEGMENT_ORDER_INVALID");
	});

	test("variant hash mismatch is detected without mutating the anchor", () => {
		const anchor = buildByosanContentAnchor(referenceSpec());
		const variant = buildByosanPresentationVariant(
			anchor,
			skin("youtube_feature"),
		);
		const tampered = {
			...variant,
			contentAnchorHash: "0".repeat(64),
		};
		expect(
			auditByosanPresentationVariant(anchor, tampered).map(
				(issue) => issue.code,
			),
		).toContain("content_anchor_hash_mismatch");
	});
});
