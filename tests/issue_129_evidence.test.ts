import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

type EvidenceLedger = {
	status: string;
	issuerFacts: Array<{ id: string; status: string }>;
	marketComparison: {
		status: string;
		historicalDossierValue: { status: string };
		verifiedMarketReadback: {
			status: string;
			marketPrice: number;
			discountToReportedNavPercent: number;
			discountToModifiedNavPercent: number;
			navReferenceDateStatus: string;
		};
	};
	sources: Array<{ tier: string; url: string }>;
	visualPlan: { formats: string[]; sourceDateOnScreen: boolean };
	openAcceptance: string[];
};

const ledger = fs.readJsonSync(
	"config/evidence/issue_129_mitsui_nav_20260924.json",
) as EvidenceLedger;

describe("issue 129 evidence ledger", () => {
	test("keeps issuer NAV facts distinct from market-price evidence", () => {
		expect(ledger.status).toBe("PARTIAL_UNVERIFIED");
		expect(ledger.issuerFacts.map((fact) => fact.id)).toEqual([
			"reported_nav",
			"fy2025_results",
			"balance_sheet_context",
			"forward_rate_and_profit_context",
			"office_context",
		]);
		for (const fact of ledger.issuerFacts) {
			expect(fact.status).toMatch(/^VERIFIED_/);
		}
		expect(ledger.marketComparison.status).toBe(
			"PARTIAL_CURRENT_PRICE_READBACK_NAV_DATE_UNALIGNED",
		);
		expect(ledger.marketComparison.historicalDossierValue.status).toBe(
			"REQUIRES_RECHECK_BEFORE_PRODUCTION",
		);
		expect(ledger.marketComparison.verifiedMarketReadback).toMatchObject({
			status: "VERIFIED_MARKET_CLOSE_READBACK",
			marketPrice: 1501,
			discountToReportedNavPercent: 32.1267,
			discountToModifiedNavPercent: 41.1373,
			navReferenceDateStatus: "REQUIRES_EXACT_DATE_ALIGNMENT",
		});
	});

	test("requires primary-source dates and both delivery formats", () => {
		expect(ledger.sources.filter((source) => source.tier === "L1").length).toBe(
			3,
		);
		for (const source of ledger.sources) {
			expect(source.url).toMatch(/^https:\/\//);
		}
		expect(ledger.visualPlan.formats).toEqual(["16:9", "9:16"]);
		expect(ledger.visualPlan.sourceDateOnScreen).toBe(true);
		expect(ledger.openAcceptance).toHaveLength(4);
	});
});
