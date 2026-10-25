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
	archetypeSlotPromptPolicy,
	auditByosanFeatureSpec,
	buildByosanSceneRule,
	parseAndAuditByosanFeatureSpec,
	staticSceneMotionFilter,
} from "../src/domain/byosan/feature_spec.js";
import type { ByosanScenesConfig } from "../src/domain/byosan/scene_spec.js";
import {
	loadConfig,
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

function withParadoxArchetype(spec: ByosanFeatureSpec): ByosanFeatureSpec {
	if (!spec.production) throw new Error("production fixture is missing");
	const slotBindings = [
		{ slot: "fact_a", segmentIndex: 0, claimId: "claim_0" },
		{ slot: "fact_b", segmentIndex: 4, claimId: "claim_1" },
		{ slot: "hidden_mechanism", segmentIndex: 8, claimId: "claim_2" },
		{ slot: "catalyst_or_incentive", segmentIndex: 12, claimId: "claim_0" },
	] as const;
	const evidenceSlots = slotBindings.map((binding) => {
		const claim = spec.claims.find((item) => item.id === binding.claimId);
		const sourceId = claim?.sourceIds[0];
		if (!sourceId) throw new Error(`claim source missing: ${binding.claimId}`);
		return {
			slot: binding.slot,
			statement: `${binding.slot} is grounded in ${sourceId}`,
			sourceIds: [sourceId],
			adversarialEvidenceIds: [],
		};
	});
	const segments = spec.segments.map((segment, index) => {
		const binding = slotBindings.find((item) => item.segmentIndex === index);
		if (!binding) return segment;
		return {
			...segment,
			archetypeSlot: binding.slot,
			claimIds: [binding.claimId],
		};
	});
	return {
		...spec,
		segments,
		production: {
			...spec.production,
			narrativeArchetype: "paradox_resolution",
			archetypeRequiredSlots: [
				"fact_a",
				"fact_b",
				"hidden_mechanism",
				"catalyst_or_incentive",
			],
			archetypeReasons: ["eligible_bundle=paradox_resolution"],
			archetypeEvidence: {
				archetype: "paradox_resolution",
				slots: evidenceSlots,
			},
		},
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

	test("production-aware specs enforce grounded packaging and Fact -> Context -> Impact", async () => {
		const spec = productionAwareSpec(await loadReferenceSpec());
		expect(auditByosanFeatureSpec(spec)).toEqual([]);
		expect(parseAndAuditByosanFeatureSpec(spec).production?.format).toBe(
			"regular",
		);
	});

	test("unsupported breaking and extreme wording fail closed", async () => {
		const spec = productionAwareSpec(await loadReferenceSpec());
		spec.title = "【速報】過去最大のS&P500利益+47.4%";
		const issues = auditByosanFeatureSpec(spec);
		expect(issues.map((issue) => issue.code)).toContain(
			"freshness_marker_ungrounded",
		);
		expect(issues.map((issue) => issue.code)).toContain(
			"relative_claim_ungrounded",
		);
	});

	test("the opening must share a packaging claim with the title and thumbnail", async () => {
		const spec = productionAwareSpec(await loadReferenceSpec());
		for (const segment of spec.segments.slice(0, 2)) {
			segment.claimIds = [];
		}
		expect(auditByosanFeatureSpec(spec).map((issue) => issue.code)).toContain(
			"packaging_claim_not_in_opening",
		);
	});

	test("the primary packaging claim must carry a figure the catch can check", async () => {
		const spec = productionAwareSpec(await loadReferenceSpec());
		const primary = spec.claims.find(
			(claim) => claim.id === spec.packaging?.primaryClaimId,
		);
		if (!primary) throw new Error("primary packaging claim is missing");
		primary.claim = "物価上昇は耐久財にも広がった。";
		expect(auditByosanFeatureSpec(spec).map((issue) => issue.code)).toContain(
			"packaging_primary_claim_without_figure",
		);
	});

	test("L3-only claims must carry an epistemic boundary", async () => {
		const spec = productionAwareSpec(await loadReferenceSpec());
		spec.sources = spec.sources.map((source) => ({
			...source,
			tier: source.id === "factset_0731" ? "L3" : "L1",
		}));
		const primaryClaim = spec.claims.find((claim) => claim.id === "claim_0");
		if (!primaryClaim) throw new Error("primary claim fixture is missing");
		expect(auditByosanFeatureSpec(spec).map((issue) => issue.code)).toContain(
			"vendor_claim_boundary_missing",
		);
		primaryClaim.epistemicBoundary =
			"これは発表主体側の数値で、第三者検証済みとは扱いません。";
		expect(
			auditByosanFeatureSpec(spec).map((issue) => issue.code),
		).not.toContain("vendor_claim_boundary_missing");
	});

	test("production memo phrases never reach the dialogue", async () => {
		const spec = productionAwareSpec(await loadReferenceSpec());
		const segment = spec.segments[0];
		if (!segment) throw new Error("segment fixture is missing");
		segment.text = `${segment.text}分析では、そう言えます。`;
		expect(auditByosanFeatureSpec(spec).map((issue) => issue.code)).toContain(
			"production_memo_in_dialogue",
		);
	});

	test("inferred claims require confidence and mismatch review", async () => {
		const spec = productionAwareSpec(await loadReferenceSpec());
		const inferred = spec.claims.find((claim) => claim.status !== "verified");
		if (!inferred) throw new Error("inferred claim fixture is missing");
		inferred.confidence = undefined;
		inferred.unresolvedMismatches = undefined;
		const codes = auditByosanFeatureSpec(spec).map((issue) => issue.code);
		expect(codes).toContain("inference_confidence_missing");
		expect(codes).toContain("inference_mismatch_review_missing");
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

	test("hook promises reject more than twenty-four characters", () => {
		expect(
			ByosanFeatureSpecSchema.shape.hookPromises.safeParse([
				"a".repeat(25),
				"b",
			]).success,
		).toBe(false);
		expect(
			ByosanFeatureSpecSchema.shape.hookPromises.safeParse([
				"a".repeat(24),
				"b",
			]).success,
		).toBe(true);
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

	test("archetype slot prompt policy lists exactly the slots the audit accepts", () => {
		expect(archetypeSlotPromptPolicy("standard")).toContain(
			"出力しないでください",
		);
		expect(archetypeSlotPromptPolicy(undefined)).toContain(
			"出力しないでください",
		);
		expect(archetypeSlotPromptPolicy("paradox_resolution")).toContain(
			"fact_a, fact_b, hidden_mechanism, catalyst_or_incentive",
		);
	});

	test("draft prompt limits are derived from the feature draft schema", () => {
		const lines = zodSizeConstraintLines(ByosanFeatureDraftSchema);
		expect(lines).toContain("thumbnail.reaction: 1〜4文字");
		expect(lines).toContain("thumbnail.secondLine: 2〜12文字");
		expect(lines).toContain("segments: 20〜36件");
		expect(lines).toContain("segments[].stats: 0〜3件");
		expect(lines).toContain("segments[].text: 18〜180文字");
	});

	test("scene rule caps non-stat scenes and requires claim source names to be shown", () => {
		const scenes = (
			loadConfig("byosan_money") as unknown as { scenes: ByosanScenesConfig }
		).scenes;
		const rule = buildByosanSceneRule(scenes, 0.4);
		expect(rule).toContain(`${scenes.min_distinct_kinds}種類以上`);
		expect(rule).toContain("全場面に対する割合を40%以下");
		expect(rule).toContain("sourcesのnameを略さず");
	});
});
