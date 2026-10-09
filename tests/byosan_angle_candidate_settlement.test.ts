import { describe, expect, test } from "bun:test";
import { settleByosanAngleCandidate } from "../src/domain/byosan/news_angle.js";

const validCandidate = {
	topic: "指数利益とAI投資評価益の分解",
	angle: "指数の大幅増益を本業と非現金評価益に分解する",
	titleHook: "指数利益47%増、そのうち何割が本業なのか",
	whyNow: "最新決算と規制資料が同日にそろい市場の数字を検証できる",
	hiddenMechanism:
		"巨大企業の非現金評価益が時価総額加重指数の集計利益を押し上げている仕組み",
	counterfactual:
		"評価益を除いた場合と上位2社を除いた場合の利益成長率を再計算して比較する",
	audiencePayoff: "見出しの利益成長を本業の強さと取り違えず投資判断に使える",
	numbers: ["47.4%", "28.8%"],
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
	noveltyFingerprint: "評価益控除後の指数利益成長という切り口",
	visualPlan: "利益の分解を積み上げ棒で見せる",
	risks: ["四半期データの改定可能性"],
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
};

describe("settleByosanAngleCandidate", () => {
	test("accepts a complete candidate as VALID", () => {
		const settled = settleByosanAngleCandidate(validCandidate);
		expect(settled.status).toBe("VALID");
	});

	test("rejects a candidate with fewer than two sources without throwing", () => {
		const settled = settleByosanAngleCandidate({
			...validCandidate,
			sources: [validCandidate.sources[0]],
		});
		expect(settled.status).toBe("REJECTED");
		if (settled.status !== "REJECTED") return;
		expect(settled.issues.some((issue) => issue.startsWith("sources"))).toBe(
			true,
		);
	});

	test("rejects a non-object payload with at least one issue", () => {
		const settled = settleByosanAngleCandidate("not a candidate");
		expect(settled.status).toBe("REJECTED");
		if (settled.status !== "REJECTED") return;
		expect(settled.issues.length).toBeGreaterThan(0);
	});
});
