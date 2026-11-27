import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import { z } from "zod";
import {
	auditByosanFeatureSpec,
	ByosanFeatureDraftSchema,
	ByosanFeatureSegmentSchema,
	ByosanFeatureSpecSchema,
	ByosanThumbnailSchema,
	parseAndAuditByosanFeatureSpec,
} from "../src/domain/byosan/feature_spec.js";
import {
	providerResponseJsonSchema,
	zodSizeConstraintLines,
} from "../src/io/core.js";

const SPEC_PATH = "config/productions/sp500_anthropic_2026q2.json";

describe("byosan feature specification", () => {
	test("the production reference remains compatible with the runtime schema", async () => {
		const spec = parseAndAuditByosanFeatureSpec(await fs.readJson(SPEC_PATH));
		expect(spec.segments.length).toBeGreaterThanOrEqual(20);
		expect(auditByosanFeatureSpec(spec)).toEqual([]);
	});

	test("legacy public-note and audit fields are stripped at the schema boundary", async () => {
		const legacy = await fs.readJson(SPEC_PATH);
		legacy.disclaimer = "旧免責欄";
		legacy.adversarialEvidence = [];
		legacy.activeProbes = [];
		legacy.claims[0].caveat = "旧注釈";
		legacy.claims[0].epistemicBoundary = "旧境界";
		legacy.claims[0].unresolvedMismatches = ["旧不一致"];
		const spec = ByosanFeatureSpecSchema.parse(legacy);
		expect(spec).not.toHaveProperty("disclaimer");
		expect(spec).not.toHaveProperty("adversarialEvidence");
		expect(spec).not.toHaveProperty("activeProbes");
		expect(spec.claims[0]).not.toHaveProperty("caveat");
		expect(spec.claims[0]).not.toHaveProperty("epistemicBoundary");
		expect(spec.claims[0]).not.toHaveProperty("unresolvedMismatches");
	});

	test("the new draft schema has no disclaimer or caveat fields", () => {
		const schema = JSON.stringify(z.toJSONSchema(ByosanFeatureDraftSchema));
		for (const field of [
			"disclaimer",
			"caveat",
			"epistemicBoundary",
			"unresolvedMismatches",
			"adversarialEvidence",
			"activeProbes",
		]) {
			expect(schema).not.toContain(`"${field}"`);
		}
	});
});

describe("byosan structured output schema", () => {
	test("draft schema emits no const keyword that the Gemini response_schema rejects", () => {
		const serialized = JSON.stringify(z.toJSONSchema(ByosanFeatureDraftSchema));
		expect(serialized).not.toContain('"const"');
	});

	test("draft schema sent to Gemini carries no size limits", () => {
		const serialized = JSON.stringify(
			providerResponseJsonSchema(ByosanFeatureDraftSchema),
		);
		expect(serialized).not.toMatch(
			/"(minItems|maxItems|minLength|maxLength|minimum|maximum|pattern)"/,
		);
		expect(serialized).toContain('"segments"');
	});
});

describe("byosan feature draft hard limits", () => {
	test("thumbnail reaction rejects more than four characters", () => {
		expect(
			ByosanThumbnailSchema.shape.reaction.safeParse("12345").success,
		).toBe(false);
		expect(ByosanThumbnailSchema.shape.reaction.safeParse("1234").success).toBe(
			true,
		);
	});

	test("segment stats accept an empty list and reject more than three", () => {
		const stat = {
			label: "利益",
			value: "28.8%",
			detail: "前年比",
			color: "cyan",
		};
		expect(ByosanFeatureSegmentSchema.shape.stats.safeParse([]).success).toBe(
			true,
		);
		expect(
			ByosanFeatureSegmentSchema.shape.stats.safeParse([stat, stat, stat, stat])
				.success,
		).toBe(false);
		expect(
			ByosanFeatureSegmentSchema.shape.stats.safeParse([stat]).success,
		).toBe(true);
	});

	test("draft prompt limits are derived from the feature draft schema", () => {
		const lines = zodSizeConstraintLines(ByosanFeatureDraftSchema);
		expect(lines).toContain("thumbnail.reaction: 4文字以内");
		expect(lines).toContain("thumbnail.secondLine: 2〜12文字");
		expect(lines).toContain("segments[].stats: 3件以内");
		expect(lines).toContain("segments[].headline: 34文字以内");
		expect(lines.some((line) => line.startsWith("segments: "))).toBe(false);
		expect(lines.some((line) => line.startsWith("segments[].text:"))).toBe(
			false,
		);
	});

	test("segment dialogue of any length is accepted", () => {
		const segment = {
			speaker: "春日部つむぎ",
			emotion: "analytical",
			section: "結論",
			headline: "数字は一つだけ",
			subheadline: "長い台詞でも字幕は分割して収める",
			visualType: "bignumber",
			stats: [],
			source: "出典名",
			text: "あ".repeat(500),
		};
		expect(ByosanFeatureSegmentSchema.safeParse(segment).success).toBe(true);
	});
});
