import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import { z } from "zod";
import {
	ByosanFeatureDraftSchema,
	ByosanFeatureSegmentSchema,
	type ByosanFeatureSpec,
	ByosanFeatureSpecSchema,
	type ByosanNarrativeRole,
	ByosanThumbnailSchema,
	type FeatureSpecIssue,
	auditByosanFeatureSpec,
	isBlockingFeatureIssue,
	parseAndAuditByosanFeatureSpec,
	staticSceneMotionFilter,
} from "../src/domain/byosan/feature_spec.js";
import {
	providerResponseJsonSchema,
	zodSizeConstraintLines,
} from "../src/io/core.js";

const SPEC_PATH = "config/productions/sp500_anthropic_2026q2.json";

function productionAwareSpec(base: ByosanFeatureSpec): ByosanFeatureSpec {
	const claims = base.claims.map((claim, index) => ({
		...claim,
		id: `claim_${index}`,
		...(claim.status === "verified"
			? {}
			: {
					caveat: "推計または派生値であり、前提条件に依存する",
					confidence: 0.8,
					unresolvedMismatches: [],
				}),
	}));
	const adversarialEvidence = [
		{
			id: "evidence_0",
			kind: "counter_metric" as const,
			targetClaim: claims[0]?.claim ?? "S&P500利益成長率",
			statement: "上位2社を除くと利益成長率は28.8%まで低下する",
			sourceIds: ["factset_0731"],
			checkedSourceIds: ["factset_0731", "amazon_10q"],
		},
		{
			id: "evidence_1",
			kind: "measurement_condition" as const,
			targetClaim: claims[1]?.claim ?? "Amazon純利益",
			statement: "純利益には非現金の株式評価益が含まれている",
			sourceIds: ["amazon_10q"],
			checkedSourceIds: ["amazon_10q", "factset_0731"],
		},
		{
			id: "evidence_2",
			kind: "source_limitation" as const,
			targetClaim: claims[2]?.claim ?? "Amazon評価益",
			statement: "評価益は市場価格の変動で将来反転する可能性がある",
			sourceIds: ["amazon_10q"],
			checkedSourceIds: ["amazon_10q", "factset_0731"],
		},
	];
	const claimEvidence = [
		{ claimId: "claim_0", evidenceId: "evidence_0" },
		{ claimId: "claim_1", evidenceId: "evidence_1" },
		{ claimId: "claim_2", evidenceId: "evidence_2" },
	];
	const segments = base.segments.slice(0, 28).map((segment, index) => {
		const group = index < 12 ? Math.floor(index / 4) : -1;
		const slot = index % 4;
		const binding = group >= 0 ? claimEvidence[group] : undefined;
		if (!binding) {
			return {
				...segment,
				narrativeRole: "action" as const,
			};
		}
		const narrativeRole =
			slot === 0
				? ("fact" as const)
				: slot === 3
					? ("impact" as const)
					: ("context" as const);
		const verificationRole =
			slot === 0
				? ("presenter" as const)
				: slot === 1
					? ("auditor" as const)
					: slot === 2
						? ("resolution" as const)
						: ("landing" as const);
		const boundClaim = claims.find((claim) => claim.id === binding.claimId);
		const inferenceSuffix =
			boundClaim?.status !== "verified" && verificationRole === "landing"
				? " これは分析で、確度80%です。"
				: "";
		return {
			...segment,
			text: `${segment.text}${inferenceSuffix}`,
			speaker:
				verificationRole === "auditor"
					? ("ずんだもん" as const)
					: ("春日部つむぎ" as const),
			narrativeRole,
			verificationRole,
			claimIds: [binding.claimId],
			...(verificationRole === "auditor" || verificationRole === "resolution"
				? { evidenceIds: [binding.evidenceId] }
				: {}),
		};
	});
	return {
		...base,
		title: "S&P500利益+47.4%の中身を一次資料で検証",
		claims,
		segments,
		production: {
			format: "regular",
			targetMinutes: 6,
			minSegments: 20,
			maxSegments: 28,
			reasons: ["weighted_score=80"],
		},
		packaging: {
			primaryClaimId: "claim_0",
			claimIds: ["claim_0", "claim_1", "claim_2"],
		},
		narrative: {
			hiddenMechanism:
				"巨大企業の非現金評価益が時価総額加重指数の集計利益を押し上げる",
			counterfactual:
				"AlphabetとAmazonを除いた場合の利益成長率を同じ分母で比較する",
			audiencePayoff: "見出し利益と本業成長を分けて投資判断に使える",
		},
		adversarialEvidence,
	};
}

async function loadReferenceSpec(): Promise<ByosanFeatureSpec> {
	return ByosanFeatureSpecSchema.parse(await fs.readJson(SPEC_PATH));
}

describe("byosan feature specification", () => {
	test("the reference production satisfies the reusable schema", async () => {
		const spec = parseAndAuditByosanFeatureSpec(await fs.readJson(SPEC_PATH));
		expect(spec.segments.length).toBeGreaterThanOrEqual(20);
		expect(auditByosanFeatureSpec(spec)).toEqual([]);
	});

	test("production-aware specs pass the feature checks", async () => {
		const spec = productionAwareSpec(await loadReferenceSpec());
		expect(auditByosanFeatureSpec(spec)).toEqual([]);
		expect(parseAndAuditByosanFeatureSpec(spec).production?.format).toBe(
			"regular",
		);
	});

	test("unsupported breaking and extreme wording are warnings, not blocking failures", async () => {
		const spec = productionAwareSpec(await loadReferenceSpec());
		spec.title = "【速報】過去最大の株式評価益の話";
		const codes = auditByosanFeatureSpec(spec).map((issue) => issue.code);
		expect(codes).toContain("freshness_marker_ungrounded");
		expect(codes).toContain("relative_claim_ungrounded");
		expect(() => parseAndAuditByosanFeatureSpec(spec)).not.toThrow();
	});
});

describe("byosan feature issue blocking", () => {
	test("only schema, number, and source issues block the spec", () => {
		const issue = (code: string): FeatureSpecIssue => ({
			code,
			details: "",
			path: "",
		});
		expect(isBlockingFeatureIssue(issue("unsourced_number"))).toBe(true);
		expect(isBlockingFeatureIssue(issue("claim_source_missing"))).toBe(true);
		expect(isBlockingFeatureIssue(issue("schema_invalid_type"))).toBe(true);
		expect(isBlockingFeatureIssue(issue("freshness_marker_ungrounded"))).toBe(
			false,
		);
		expect(
			isBlockingFeatureIssue(issue("adversarial_evidence_source_missing")),
		).toBe(false);
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
