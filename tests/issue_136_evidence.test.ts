import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

type EvidenceLedger = {
	status: string;
	companies: Array<{
		investmentRelation: string;
		instrument: string;
		marketData: string;
	}>;
	authenticatedTrackerReadback: {
		status: string;
		readAt: string;
		sheetName: string;
		provider: string;
		rows: Array<{
			ticker: string;
			currentPrice: number;
			ytdBase: number;
			ytdDisplayed: string;
		}>;
		formulaEvidence: Record<string, string>;
	};
	reportedFacts: Array<{ status: string; sourceIds: string[] }>;
	sources: Array<{ tier: string; url: string }>;
	marketDataBoundary: {
		status: string;
		requiredFields: string[];
		verifiedReadbackFields: string[];
		unverifiedFields: string[];
	};
	causalityBoundary: { status: string; classification: string[] };
	visualPlan: { formats: string[]; sourceDateOnScreen: boolean };
	openAcceptance: string[];
};

const ledger = fs.readJsonSync(
	"config/evidence/issue_136_nvidia_capital_loop_20260924.json",
) as EvidenceLedger;

describe("issue 136 evidence ledger", () => {
	test("covers all ten targets without collapsing investment and partnership", () => {
		expect(ledger.status).toBe("PARTIAL_UNVERIFIED");
		expect(ledger.companies).toHaveLength(10);
		expect(
			ledger.companies.some(
				(company) =>
					company.investmentRelation === "CONDITIONAL_COMMITMENT_REPORTED",
			),
		).toBe(true);
		expect(ledger.authenticatedTrackerReadback.status).toBe(
			"VERIFIED_CURRENT_YTD_READBACK",
		);
		expect(ledger.authenticatedTrackerReadback.readAt).toBe("2026-09-25");
		expect(ledger.authenticatedTrackerReadback.sheetName).toBe("Tracker");
		expect(ledger.authenticatedTrackerReadback.provider).toBe("GOOGLEFINANCE");
		expect(ledger.authenticatedTrackerReadback.rows).toHaveLength(10);
		expect(ledger.authenticatedTrackerReadback.rows[0]).toMatchObject({
			ticker: "2454.TW",
			currentPrice: 5285,
			ytdBase: 1430,
			ytdDisplayed: "269.6%",
		});
		expect(
			ledger.authenticatedTrackerReadback.formulaEvidence.currentPrice,
		).toContain("GOOGLEFINANCE");
		expect(
			ledger.companies.some(
				(company) =>
					company.investmentRelation ===
					"UNVERIFIED_DO_NOT_INFER_FROM_PARTNERSHIP",
			),
		).toBe(true);
	});

	test("labels only bounded primary facts as verified", () => {
		expect(ledger.reportedFacts).toHaveLength(4);
		for (const fact of ledger.reportedFacts) {
			expect(fact.status).toMatch(/^VERIFIED_/);
			expect(fact.sourceIds.length).toBeGreaterThan(0);
		}
		expect(
			ledger.sources.filter((source) => source.tier === "L1"),
		).toHaveLength(5);
		expect(
			ledger.sources.every((source) => source.url.startsWith("https://")),
		).toBe(true);
	});

	test("keeps market and causal claims unresolved", () => {
		expect(ledger.marketDataBoundary.status).toBe(
			"PARTIAL_CURRENT_YTD_READBACK_ANNOUNCEMENT_RETURN_UNVERIFIED",
		);
		expect(ledger.marketDataBoundary.requiredFields).toHaveLength(5);
		expect(ledger.marketDataBoundary.verifiedReadbackFields).toContain(
			"latest_price",
		);
		expect(ledger.marketDataBoundary.unverifiedFields).toContain(
			"return_since_announcement",
		);
		expect(ledger.causalityBoundary.status).toBe("UNVERIFIED_NO_CAUSAL_CLAIM");
		expect(ledger.causalityBoundary.classification).toEqual([
			"confirmed",
			"inferred",
			"unknown",
		]);
		expect(ledger.visualPlan.formats).toEqual(["16:9", "9:16"]);
		expect(ledger.visualPlan.sourceDateOnScreen).toBe(true);
		expect(ledger.openAcceptance).toHaveLength(4);
	});
});
