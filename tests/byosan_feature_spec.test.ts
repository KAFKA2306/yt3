import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import {
	type ByosanFeatureSpec,
	ByosanFeatureSpecSchema,
	type ByosanNarrativeRole,
	auditByosanFeatureSpec,
	centerLockedMotionFilter,
	parseAndAuditByosanFeatureSpec,
	quantizedCenterOrigin,
} from "../src/domain/byosan/feature_spec.js";

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

	test("specialized archetype slots must appear in order with claim provenance", async () => {
		const spec = withParadoxArchetype(
			productionAwareSpec(await loadReferenceSpec()),
		);
		expect(auditByosanFeatureSpec(spec)).toEqual([]);

		const factA = spec.segments.find(
			(segment) => segment.archetypeSlot === "fact_a",
		);
		const factB = spec.segments.find(
			(segment) => segment.archetypeSlot === "fact_b",
		);
		if (!factA || !factB) throw new Error("archetype fixture is incomplete");
		factA.archetypeSlot = "fact_b";
		factB.archetypeSlot = "fact_a";
		expect(auditByosanFeatureSpec(spec).map((issue) => issue.code)).toContain(
			"archetype_slot_sequence_missing",
		);
	});

	test("archetype slot evidence must match a claim source spoken in that slot", async () => {
		const spec = withParadoxArchetype(
			productionAwareSpec(await loadReferenceSpec()),
		);
		const evidence = spec.production?.archetypeEvidence?.slots.find(
			(slot) => slot.slot === "fact_a",
		);
		const claim = spec.claims.find((item) => item.id === "claim_0");
		if (!evidence || !claim)
			throw new Error("archetype provenance fixture missing");
		const unrelated = spec.sources.find(
			(source) => !claim.sourceIds.includes(source.id),
		);
		if (!unrelated) throw new Error("unrelated source fixture missing");
		evidence.sourceIds = [unrelated.id];
		expect(auditByosanFeatureSpec(spec).map((issue) => issue.code)).toContain(
			"archetype_slot_claim_provenance_missing",
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

	test("fact segments require claim grounding under the new narrative contract", async () => {
		const spec = productionAwareSpec(await loadReferenceSpec());
		const first = spec.segments[0];
		if (!first) throw new Error("reference spec has no first segment");
		const { claimIds, ...ungroundedFirst } = first;
		expect(claimIds).toEqual(["claim_0"]);
		spec.segments = [ungroundedFirst, ...spec.segments.slice(1)];
		expect(auditByosanFeatureSpec(spec).map((issue) => issue.code)).toContain(
			"fact_segment_claim_missing",
		);
	});

	test("auditor interjections without evidence do not satisfy the verifier slot", async () => {
		const spec = productionAwareSpec(await loadReferenceSpec());
		const auditor = spec.segments.find(
			(segment) => segment.verificationRole === "auditor",
		);
		if (!auditor) throw new Error("auditor fixture is missing");
		auditor.evidenceIds = undefined;
		expect(auditByosanFeatureSpec(spec).map((issue) => issue.code)).toContain(
			"adversarial_dialogue_sequence_missing",
		);
	});

	test("L3-only claims must speak their epistemic boundary", async () => {
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
		const resolution = spec.segments.find(
			(segment) =>
				segment.verificationRole === "resolution" &&
				segment.claimIds?.includes("claim_0"),
		);
		if (!resolution) throw new Error("resolution fixture is missing");
		resolution.text = primaryClaim.epistemicBoundary;
		const codes = auditByosanFeatureSpec(spec).map((issue) => issue.code);
		expect(codes).not.toContain("vendor_claim_boundary_missing");
		expect(codes).not.toContain("vendor_claim_boundary_not_spoken");
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

	test("unresolved mismatches must be spoken for narrated inferred claims", async () => {
		const spec = productionAwareSpec(await loadReferenceSpec());
		const inferred = spec.claims.find((claim) => claim.id === "claim_2");
		if (!inferred?.id) throw new Error("narrated claim fixture is missing");
		inferred.status = "derived_with_caveat";
		inferred.caveat = "複数の観測値を統合した分析です";
		inferred.confidence = 0.8;
		inferred.unresolvedMismatches = [
			"外部比較では同じ傾向をまだ確認できていません",
		];
		const landing = spec.segments.find(
			(segment) =>
				segment.verificationRole === "landing" &&
				segment.claimIds?.includes(inferred.id ?? ""),
		);
		if (!landing) throw new Error("landing fixture is missing");
		landing.text += " これは分析で、確度80%です。";
		const codes = auditByosanFeatureSpec(spec).map((issue) => issue.code);
		expect(codes).toContain("inference_mismatch_not_spoken");
		landing.text += " 外部比較では同じ傾向をまだ確認できていません";
		expect(
			auditByosanFeatureSpec(spec).map((issue) => issue.code),
		).not.toContain("inference_mismatch_not_spoken");
	});

	test("motion keeps crop origins on the even-pixel chroma grid", () => {
		const filter = centerLockedMotionFilter();
		expect(filter).toContain("floor((iw-iw/zoom)/4)*2");
		expect(filter).toContain("floor((ih-ih/zoom)/4)*2");
		expect(filter).not.toMatch(/sin|cos/);
	});

	test("quantized center origins move monotonically without vertical sign reversal", () => {
		const zooms = Array.from({ length: 901 }, (_, index) => 1 + index * 0.0002);
		const verticalOrigins = zooms.map((zoom) =>
			quantizedCenterOrigin(1080, zoom),
		);
		for (let index = 1; index < verticalOrigins.length; index++) {
			expect(verticalOrigins[index]).toBeGreaterThanOrEqual(
				verticalOrigins[index - 1] ?? 0,
			);
			expect((verticalOrigins[index] ?? 0) % 2).toBe(0);
		}
	});
});
