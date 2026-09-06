import { describe, expect, test } from "bun:test";
import {
	type ByosanAngleCandidate,
	byosanTextSimilarity,
	evaluateByosanAngleCandidate,
	selectByosanAngle,
	selectByosanProductionPlan,
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

	test("fresh primary evidence can select breaking without an LLM classifier", () => {
		const item = candidate({
			angle: "24時間で47.4%と28.8%と19ポイントの差が同時に確定した指数利益の異変",
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
});
