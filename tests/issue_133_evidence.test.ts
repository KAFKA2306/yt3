import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

type EvidenceLedger = {
	status: string;
	policyDecisions: Array<{ status: string; sourceIds: string[] }>;
	currentMarketReadback: {
		status: string;
		readAt: string;
		close: { value: number; asOf: string };
		oneMonthRange: {
			high: { value: number; date: string };
			low: { value: number; date: string };
		};
	};
	fxDecomposition: { status: string; components: Array<{ status: string }> };
	scenarioPlan: Array<{ status: string }>;
	sources: Array<{ tier: string; url: string }>;
	visualPlan: { formats: string[]; sourceDateOnScreen: boolean };
	openAcceptance: string[];
};

const ledger = fs.readJsonSync(
	"config/evidence/issue_133_boj_usdjpy_20260924.json",
) as EvidenceLedger;

describe("issue 133 evidence ledger", () => {
	test("separates verified policy decisions from unverified market decomposition", () => {
		expect(ledger.status).toBe("PARTIAL_UNVERIFIED");
		expect(ledger.policyDecisions).toHaveLength(3);
		for (const decision of ledger.policyDecisions) {
			expect(decision.status).toMatch(/^VERIFIED_/);
			expect(decision.sourceIds.length).toBeGreaterThan(0);
		}
		expect(ledger.currentMarketReadback.status).toBe(
			"VERIFIED_DATED_MARKET_REFERENCE",
		);
		expect(ledger.currentMarketReadback.readAt).toBe("2026-09-25");
		expect(ledger.currentMarketReadback.close).toMatchObject({
			value: 158.34,
			asOf: "2026-09-24",
			currencyPerUsd: "JPY",
		});
		expect(ledger.currentMarketReadback.oneMonthRange).toEqual({
			high: { value: 160.2, date: "2026-09-02" },
			low: { value: 153.49, date: "2026-09-14" },
		});
		expect(ledger.fxDecomposition.status).toBe(
			"UNVERIFIED_REQUIRES_PRODUCTION_SNAPSHOT",
		);
		expect(ledger.fxDecomposition.components).toHaveLength(6);
		expect(ledger.fxDecomposition.components[0].status).toBe(
			"VERIFIED_DATED_MARKET_REFERENCE_NOT_INTRADAY",
		);
	});

	test("keeps scenarios and wire context from becoming forecasts", () => {
		expect(ledger.scenarioPlan).toHaveLength(4);
		expect(
			ledger.scenarioPlan.every(
				(scenario) => scenario.status !== "VERIFIED_OUTCOME",
			),
		).toBe(true);
	});

	test("requires dated primary links and both delivery formats", () => {
		expect(
			ledger.sources.filter((source) => source.tier === "L1"),
		).toHaveLength(5);
		expect(
			ledger.sources.every((source) => source.url.startsWith("https://")),
		).toBe(true);
		expect(ledger.visualPlan.formats).toEqual(["16:9", "9:16"]);
		expect(ledger.visualPlan.sourceDateOnScreen).toBe(true);
		expect(ledger.openAcceptance).toHaveLength(4);
	});
});
