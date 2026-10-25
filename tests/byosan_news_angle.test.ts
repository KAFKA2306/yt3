import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	type ByosanAngleCandidate,
	byosanTextSimilarity,
	evaluateByosanAngleCandidate,
	isCurrentByosanAngleDecision,
	loadPublishedByosanSourceUrls,
	normalizeByosanAngleCandidateForm,
	selectByosanAngle,
	selectByosanProductionPlan,
	settleByosanAngleCandidate,
} from "../src/domain/byosan/news_angle.js";
import { fixtureAt } from "./fixtures/fixture_at.js";

const gate = {
	minCandidateCount: 5,
	minDistinctPublishers: 3,
	repeatWindowDays: 60,
};

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
		const result = evaluateByosanAngleCandidate(
			candidate(),
			[],
			new Set<string>(),
		);
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
		const result = evaluateByosanAngleCandidate(item, [], new Set<string>());
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
		const result = evaluateByosanAngleCandidate(item, [], new Set<string>());
		expect(result.passed).toBe(false);
		expect(result.hardGateFailures).toContain(
			"no_counter_evidence_scope_too_narrow",
		);
	});

	test("recent-topic duplication blocks the candidate", () => {
		const item = candidate();
		const result = evaluateByosanAngleCandidate(
			item,
			[`${item.titleHook} ${item.topic} ${item.noveltyFingerprint}`],
			new Set<string>(),
		);
		expect(result.passed).toBe(false);
		expect(result.hardGateFailures).toContain(
			"recent_topic_similarity_above_0_42",
		);
	});

	test("a candidate citing a published primary source is excluded before the collection gate", () => {
		const repeated = candidate();
		const fresh = candidate({
			topic: "別の観測",
			sources: candidate().sources.map((source) => ({
				...source,
				url: `https://other.example.com/${source.id}`,
			})),
		});
		const result = selectByosanAngle(
			[repeated, fresh],
			[],
			{ ...gate, minCandidateCount: 1, minDistinctPublishers: 1 },
			new Set(["https://www.sec.gov/filing"]),
		);
		expect(result.decision).toBe("PASS");
		expect(result.selectedIndex).toBe(1);
		expect(result.evaluated[0]?.hardGateFailures).toContain(
			"source_already_published",
		);
	});

	test("the collection gate requires the configured candidate count", () => {
		const result = selectByosanAngle(
			[candidate()],
			[],
			gate,
			new Set<string>(),
		);
		expect(result.decision).toBe("STOP");
		expect(result.reason).toContain("fewer_than_5_candidates");
	});

	test("the collection gate follows the configured minimums", () => {
		const result = selectByosanAngle(
			[candidate()],
			[],
			{ ...gate, minCandidateCount: 1, minDistinctPublishers: 2 },
			new Set<string>(),
		);
		expect(result.decision).toBe("PASS");
		expect(result.selectedIndex).toBe(0);
	});

	test("normalizes numeric figures and lower-case source tiers before settlement", () => {
		const settled = settleByosanAngleCandidate({
			...candidate(),
			numbers: [47.4, "28.8%"],
			sources: candidate().sources.map((source) => ({
				...source,
				tier: source.tier.toLowerCase(),
			})),
		});
		expect(settled.status).toBe("VALID");
		if (settled.status !== "VALID") return;
		expect(settled.candidate.numbers).toEqual(["47.4", "28.8%"]);
		expect(settled.candidate.sources.map((source) => source.tier)).toEqual([
			"L1",
			"L3",
		]);
	});

	test("leaves a tier outside the L1-L5 range for the schema to reject", () => {
		const invalid = {
			...candidate(),
			sources: [
				{ ...candidate().sources[0], tier: "L9" },
				candidate().sources[1],
			],
		};
		expect(normalizeByosanAngleCandidateForm(invalid)).toMatchObject({
			sources: [{ tier: "L9" }, { tier: "L3" }],
		});
		expect(settleByosanAngleCandidate(invalid).status).toBe("REJECTED");
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
		const evaluated = evaluateByosanAngleCandidate(item, [], new Set<string>());
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
		const evaluated = evaluateByosanAngleCandidate(item, [], new Set<string>());
		expect(evaluated.passed).toBe(false);
		expect(evaluated.hardGateFailures).toContain(
			"archetype_evidence_source_missing",
		);
	});

	test("ranking selects only after collection and candidate hard gates pass", () => {
		const candidates = Array.from({ length: 5 }, (_, index) =>
			candidate({
				topic: `市場構造の分解候補${index}`,
				angle: `見出し数字を異なる分母${index}で分解して市場の錯覚を測る`,
				titleHook: `候補${index}の大数字を一次資料で分解すると何が残るか`,
				noveltyFingerprint: `固有の反実仮想パターン${index}と比較単位${index}`,
				explorationProfile: {
					geography: fixtureAt(["US", "JP"], index % 2),
					sector: fixtureAt(["technology", "energy", "finance"], index % 3),
					actorType: fixtureAt(
						["index provider", "regulator", "utility"],
						index % 3,
					),
					eventType: fixtureAt(["earnings", "rule", "outage"], index % 3),
					timeHorizon: fixtureAt(["quarter", "year"], index % 2),
					causalDirection: fixtureAt(
						["market_to_economy", "economy_to_market", "policy_to_market"],
						index % 3,
					),
					financialMetric: fixtureAt(["earnings", "fcf", "credit"], index % 3),
					supplyChainLayer: fixtureAt(
						["platform", "component", "logistics"],
						index % 3,
					),
					marketRealEconomy: fixtureAt(["market", "real_economy"], index % 2),
					dataSurface: fixtureAt(["filing", "statistic", "tariff"], index % 3),
					scale: fixtureAt(["index", "company"], index % 2),
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
		const result = selectByosanAngle(candidates, [], gate, new Set<string>());
		expect(result.decision).toBe("PASS");
		expect(result.selectedIndex).not.toBeNull();
		expect(result.distinctPublisherCount).toBeGreaterThanOrEqual(3);
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

	test("exploration axis diversity is reported but does not stop the decision", () => {
		const candidates = Array.from({ length: 5 }, (_, index) =>
			candidate({
				sources: [
					{
						...fixtureAt(candidate().sources, 0),
						url: `https://a${index}.example/x`,
					},
					{
						...fixtureAt(candidate().sources, 1),
						url: `https://b${index}.example/y`,
					},
				],
			}),
		);
		const result = selectByosanAngle(candidates, [], gate, new Set<string>());
		expect(result.decision).toBe("PASS");
		expect(result.orthogonality.failedAxes).toContain(
			"insufficient_sector_diversity",
		);
		expect(result.orthogonality.uniqueProfileCount).toBe(1);
	});
});

describe("byosan cached angle decision", () => {
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
});

describe("published source history", () => {
	const roots: string[] = [];

	afterEach(async () => {
		await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
	});

	test("collects document URLs of published runs inside the window only", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "byosan-history-"));
		roots.push(root);
		const writeRun = async (
			runId: string,
			published: boolean,
			urls: string[],
		) => {
			const runDir = path.join(root, "runs", "byosan_money", runId);
			await fs.outputJson(path.join(runDir, "source", "feature_spec.json"), {
				sources: urls.map((url) => ({ url })),
			});
			if (published) {
				await fs.outputJson(path.join(runDir, "publish", "receipt.json"), {});
			}
		};
		await writeRun("2026-10-24-daily", true, [
			"https://www.msci.com/a?utm=1",
			"https://fred.stlouisfed.org/",
		]);
		await writeRun("2026-10-22-daily", false, ["https://www.msci.com/b"]);
		await writeRun("2026-07-01-daily", true, ["https://www.msci.com/c"]);
		expect([
			...loadPublishedByosanSourceUrls(
				root,
				new Date("2026-10-25T23:59:59Z"),
				60,
			),
		]).toEqual(["https://www.msci.com/a"]);
	});
});
