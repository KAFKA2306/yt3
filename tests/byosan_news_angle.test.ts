import { describe, expect, test } from "bun:test";
import {
	type ByosanAngleCandidate,
	ByosanAngleSourceSchema,
	byosanTextSimilarity,
	evaluateByosanAngleCandidate,
	isCurrentByosanAngleDecision,
	selectByosanAngle,
	selectByosanProductionPlan,
	settleByosanAngleCandidate,
} from "../src/domain/byosan/news_angle.js";

function candidate(
	overrides: Partial<ByosanAngleCandidate> = {},
): ByosanAngleCandidate {
	return {
		topic: "指数利益とAI投資評価益の分解",
		angle: "指数の大幅増益を本業と非現金評価益に分解する",
		titleHook: "指数利益47%増、そのうち何割が本業なのか",
		whyNow: "最新決算と規制資料が同日にそろい市場の数字を検証できる",
		hiddenMechanism:
			"巨大企業の非現金評価益が時価総額加重指数の集計利益を押し上げている仕組み",
		counterfactual:
			"評価益を除いた場合と上位2社を除いた場合の利益成長率を再計算して比較する",
		audiencePayoff: "見出しの利益成長を本業の強さと取り違えず投資判断に使える",
		numbers: ["47.4%", "28.8%", "505億ドル"],
		sources: [
			{
				id: "sec",
				name: "SEC filing",
				url: "https://www.sec.gov/filing",
				publishedAt: "2026-08-01",
				tier: "L1",
				supports: ["評価益と純利益"],
			},
			{
				id: "factset",
				name: "FactSet earnings",
				url: "https://insight.factset.com/earnings",
				publishedAt: "2026-08-01",
				tier: "L3",
				supports: ["指数利益成長率"],
			},
		],
		noveltyFingerprint: "評価益除外と上位2社除外の二段反実仮想",
		visualPlan: "47.4から評価益寄与を引き算し28.8へ変わる中央固定バー比較",
		risks: ["ブレンデッド値は未発表企業の予想を含む"],
		adversarialEvidence: [
			{
				id: "counter_blended",
				kind: "source_limitation",
				targetClaim: "S&P 500 Q2利益成長率47.4%",
				statement:
					"ブレンデッド利益成長率は未発表企業の予想を含み、確定実績だけの値ではない",
				sourceIds: ["factset"],
				checkedSourceIds: ["sec", "factset"],
			},
			{
				id: "counter_exclusion",
				kind: "counter_metric",
				targetClaim: "S&P 500 Q2利益成長率47.4%",
				statement:
					"AlphabetとAmazonを除く同じ集計では利益成長率が28.8%まで下がる",
				sourceIds: ["factset"],
				checkedSourceIds: ["sec", "factset"],
			},
		],
		explorationProfile: {
			geography: "US",
			sector: "technology",
			actorType: "index provider",
			eventType: "earnings",
			timeHorizon: "quarter",
			causalDirection: "market_to_economy",
			financialMetric: "earnings",
			supplyChainLayer: "platform",
			marketRealEconomy: "market",
			dataSurface: "filing",
			scale: "index",
		},
		...overrides,
	};
}

describe("byosan sharp-angle gate", () => {
	test("Japanese bigrams detect a near-duplicate without whitespace", () => {
		expect(
			byosanTextSimilarity(
				"指数利益47%増の正体はAI評価益",
				"指数利益47%増、その正体はAIの評価益",
			),
		).toBeGreaterThan(0.42);
	});

	test("a grounded numerical counterfactual can pass", () => {
		const result = evaluateByosanAngleCandidate(candidate(), []);
		expect(result.passed).toBe(true);
		expect(result.weightedScore).toBeGreaterThanOrEqual(75);
	});

	test("counter-evidence must map back to inspected candidate sources", () => {
		const item = candidate({
			adversarialEvidence: [
				{
					id: "bad_counter",
					kind: "counter_metric",
					targetClaim: "指数利益47.4%",
					statement: "外部資料では同じ条件で28.8%だった",
					sourceIds: ["missing-source"],
					checkedSourceIds: ["sec", "factset"],
				},
			],
		});
		const result = evaluateByosanAngleCandidate(item, []);
		expect(result.passed).toBe(false);
		expect(result.hardGateFailures).toContain(
			"adversarial_evidence_source_missing",
		);
	});

	test("no-counter-evidence requires an explicit multi-source search scope", () => {
		const item = candidate({
			adversarialEvidence: [
				{
					id: "none_found",
					kind: "no_counter_evidence",
					targetClaim: "指数利益47.4%",
					statement: "確認範囲では追加の重要な反証材料は見つからなかった",
					sourceIds: ["factset"],
					checkedSourceIds: ["factset"],
				},
			],
		});
		const result = evaluateByosanAngleCandidate(item, []);
		expect(result.passed).toBe(false);
		expect(result.hardGateFailures).toContain(
			"no_counter_evidence_scope_too_narrow",
		);
	});

	test("recent-topic duplication blocks the candidate", () => {
		const item = candidate();
		const result = evaluateByosanAngleCandidate(item, [
			`${item.titleHook} ${item.topic} ${item.noveltyFingerprint}`,
		]);
		expect(result.passed).toBe(false);
		expect(result.hardGateFailures).toContain(
			"recent_topic_similarity_above_0_42",
		);
	});

	test("the collection gate requires five candidates and three publishers", () => {
		const result = selectByosanAngle([candidate()], []);
		expect(result.decision).toBe("STOP");
		expect(result.reason).toContain("fewer_than_five_candidates");
	});

	test("production format is deterministic for the same evaluated evidence", () => {
		const evaluated = evaluateByosanAngleCandidate(candidate(), []);
		const first = selectByosanProductionPlan(evaluated, "2026-09-06");
		const second = selectByosanProductionPlan(evaluated, "2026-09-06");
		expect(second).toEqual(first);
		expect(["breaking", "comparison", "deep_dive", "regular"]).toContain(
			first.format,
		);
		expect(first.minSegments).toBeLessThanOrEqual(first.maxSegments);
	});

	test("provenance-complete evidence selects a specialized narrative archetype deterministically", () => {
		const item = candidate({
			archetypeEvidence: [
				{
					archetype: "paradox_resolution",
					slots: [
						{
							slot: "fact_a",
							statement: "指数利益成長率は47.4%と高い",
							sourceIds: ["factset"],
						},
						{
							slot: "fact_b",
							statement: "上位企業除外では28.8%まで低下する",
							sourceIds: ["factset"],
						},
						{
							slot: "hidden_mechanism",
							statement: "非現金評価益が集計利益を押し上げる",
							sourceIds: ["sec"],
						},
						{
							slot: "catalyst_or_incentive",
							statement: "決算開示が比較可能な時点を作った",
							sourceIds: ["sec"],
						},
					],
				},
			],
		});
		const evaluated = evaluateByosanAngleCandidate(item, []);
		expect(evaluated.passed).toBe(true);
		const first = selectByosanProductionPlan(evaluated, "2026-09-06");
		const second = selectByosanProductionPlan(evaluated, "2026-09-06");
		expect(first.narrativeArchetype).toBe("paradox_resolution");
		expect(first.archetypeRequiredSlots).toEqual([
			"fact_a",
			"fact_b",
			"hidden_mechanism",
			"catalyst_or_incentive",
		]);
		expect(second).toEqual(first);
	});

	test("archetype evidence cannot reference sources outside the candidate", () => {
		const item = candidate({
			archetypeEvidence: [
				{
					archetype: "paradox_resolution",
					slots: [
						{
							slot: "fact_a",
							statement: "外部の未登録資料に依存する事実",
							sourceIds: ["missing-source"],
						},
					],
				},
			],
		});
		const evaluated = evaluateByosanAngleCandidate(item, []);
		expect(evaluated.passed).toBe(false);
		expect(evaluated.hardGateFailures).toContain(
			"archetype_evidence_source_missing",
		);
	});

	test("fresh primary evidence can select breaking without an LLM classifier", () => {
		const item = candidate({
			angle:
				"24時間で47.4%と28.8%と19ポイントの差が同時に確定した指数利益の異変",
			hiddenMechanism:
				"47.4%から28.8%へ19ポイント縮む原因を二社の非現金評価益と指数加重で分解する",
			counterfactual:
				"47.4%から二社を除く場合は28.8%となり、19ポイント差を同じ分母で比較する",
			sources: candidate().sources.map((source) => ({
				...source,
				publishedAt: "2026-09-06",
			})),
		});
		const evaluated = evaluateByosanAngleCandidate(item, []);
		expect(evaluated.passed).toBe(true);
		const plan = selectByosanProductionPlan(evaluated, "2026-09-06");
		expect(plan.format).toBe("breaking");
	});

	test("ranking selects only after collection and candidate hard gates pass", () => {
		const candidates = Array.from({ length: 5 }, (_, index) =>
			candidate({
				topic: `市場構造の分解候補${index}`,
				angle: `見出し数字を異なる分母${index}で分解して市場の錯覚を測る`,
				titleHook: `候補${index}の大数字を一次資料で分解すると何が残るか`,
				noveltyFingerprint: `固有の反実仮想パターン${index}と比較単位${index}`,
				explorationProfile: {
					geography: ["US", "JP"][index % 2],
					sector: ["technology", "energy", "finance"][index % 3],
					actorType: ["index provider", "regulator", "utility"][index % 3],
					eventType: ["earnings", "rule", "outage"][index % 3],
					timeHorizon: ["quarter", "year"][index % 2],
					causalDirection: [
						"market_to_economy",
						"economy_to_market",
						"policy_to_market",
					][index % 3],
					financialMetric: ["earnings", "fcf", "credit"][index % 3],
					supplyChainLayer: ["platform", "component", "logistics"][index % 3],
					marketRealEconomy: ["market", "real_economy"][index % 2],
					dataSurface: ["filing", "statistic", "tariff"][index % 3],
					scale: ["index", "company"][index % 2],
				},
				sources: [
					...candidate().sources,
					{
						id: `issuer-${index}`,
						name: `Issuer ${index}`,
						url: `https://issuer${index}.example.com/report`,
						tier: "L3",
						supports: [`候補${index}の追加裏付け`],
					},
				],
			}),
		);
		const result = selectByosanAngle(candidates, []);
		expect(result.decision).toBe("PASS");
		expect(result.selectedIndex).not.toBeNull();
		expect(result.distinctPublisherCount).toBeGreaterThanOrEqual(3);
	});

	test("normalizes one source-support claim without inventing evidence", () => {
		const parsed = ByosanAngleSourceSchema.parse({
			id: "sec",
			name: "SEC filing",
			url: "https://www.sec.gov/filing",
			tier: "L1",
			supports: "評価益と純利益",
		});
		expect(parsed.supports).toEqual(["評価益と純利益"]);
	});

	test("settles a complete candidate as VALID", () => {
		const settled = settleByosanAngleCandidate(candidate());
		expect(settled.status).toBe("VALID");
	});

	test("settles an incomplete candidate as REJECTED with field issues", () => {
		const settled = settleByosanAngleCandidate({
			...candidate(),
			sources: [candidate().sources[0]],
		});
		expect(settled.status).toBe("REJECTED");
		if (settled.status !== "REJECTED") return;
		expect(settled.issues.some((issue) => issue.startsWith("sources"))).toBe(
			true,
		);
	});

	test("settles a non-object payload as REJECTED without throwing", () => {
		const settled = settleByosanAngleCandidate("not a candidate");
		expect(settled.status).toBe("REJECTED");
	});

	test("the collection gate stops when exploration axes lack diversity", () => {
		const candidates = Array.from({ length: 5 }, (_, index) =>
			candidate({
				sources: [
					{ ...candidate().sources[0], url: `https://a${index}.example/x` },
					{ ...candidate().sources[1], url: `https://b${index}.example/y` },
				],
			}),
		);
		const result = selectByosanAngle(candidates, []);
		expect(result.decision).toBe("STOP");
		expect(result.orthogonality.failedAxes).toContain(
			"insufficient_sector_diversity",
		);
		expect(result.orthogonality.uniqueProfileCount).toBe(1);
	});
});

describe("byosan cached angle decision", () => {
	const currentDecision = {
		decision: "STOP",
		selectedIndex: null,
		reason: "no candidate",
		candidateCount: 0,
		distinctPublisherCount: 0,
		orthogonality: {
			uniqueProfileCount: 0,
			geography: 0,
			sector: 0,
			actorType: 0,
			eventType: 0,
			timeHorizon: 0,
			causalDirection: 0,
			financialMetric: 0,
			supplyChainLayer: 0,
			marketRealEconomy: 0,
			dataSurface: 0,
			scale: 0,
			failedAxes: [],
		},
		evaluated: [],
	};

	test("accepts a decision that satisfies the current contract", () => {
		expect(isCurrentByosanAngleDecision(currentDecision)).toBe(true);
	});

	test("rejects a decision built under an older candidate contract", () => {
		expect(
			isCurrentByosanAngleDecision({
				decision: "PASS",
				selectedIndex: 0,
				reason: "stale",
				candidateCount: 1,
				distinctPublisherCount: 1,
				orthogonality: {},
				evaluated: [{ candidate: { angle: "old" } }],
			}),
		).toBe(false);
	});

	test("rejects a missing decision", () => {
		expect(isCurrentByosanAngleDecision(undefined)).toBe(false);
	});
});
