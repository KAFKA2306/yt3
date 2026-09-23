import { describe, expect, test } from "bun:test";
import {
	type ByosanAngleCandidate,
	ByosanAngleSourceSchema,
	byosanTextSimilarity,
	evaluateByosanAngleCandidate,
	selectByosanAngle,
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
		explorationProfile: {
			geography: "米国",
			sector: "株式指数",
			actorType: "上場企業",
			eventType: "決算",
			timeHorizon: "四半期",
			causalDirection: "利益→評価",
			financialMetric: "EPS",
			supplyChainLayer: "下流",
			marketRealEconomy: "市場価格",
			dataSurface: "決算資料",
			scale: "業界",
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

	test("ranking selects only after collection and candidate hard gates pass", () => {
		const candidates = Array.from({ length: 5 }, (_, index) =>
			candidate({
				topic: `市場構造の分解候補${index}`,
				angle: `見出し数字を異なる分母${index}で分解して市場の錯覚を測る`,
				titleHook: `候補${index}の大数字を一次資料で分解すると何が残るか`,
				noveltyFingerprint: `固有の反実仮想パターン${index}と比較単位${index}`,
				explorationProfile: {
					geography: ["米国", "日本", "台湾", "韓国", "欧州"][index] ?? "米国",
					sector:
						["株式指数", "半導体", "電力", "銀行", "物流"][index] ?? "株式指数",
					actorType:
						["上場企業", "政府", "中央銀行", "消費者", "供給者"][index] ??
						"上場企業",
					eventType:
						["決算", "政策", "統計", "設備投資", "価格"][index] ?? "決算",
					timeHorizon:
						["四半期", "1年", "数日", "3年", "数時間"][index] ?? "四半期",
					causalDirection:
						["利益→評価", "政策→需要", "金利→信用", "設備→電力", "価格→利益"][
							index
						] ?? "利益→評価",
					financialMetric:
						["EPS", "FCF", "売上", "利益率", "CapEx"][index] ?? "EPS",
					supplyChainLayer:
						["下流", "装置", "材料", "インフラ", "物流"][index] ?? "下流",
					marketRealEconomy:
						["市場価格", "実体経済", "市場価格", "実体経済", "市場価格"][
							index
						] ?? "市場価格",
					dataSurface:
						["決算資料", "政府統計", "規制文書", "受注", "価格データ"][index] ??
						"決算資料",
					scale:
						["業界", "国家", "企業", "物理インフラ", "家計"][index] ?? "業界",
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
});
