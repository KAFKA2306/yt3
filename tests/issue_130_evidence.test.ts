import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

type EvidenceLedger = {
	status: string;
	products: Array<{
		id: string;
		holdingsStatus: string;
		sourceIds: string[];
	}>;
	companies: Array<{ id: string }>;
	coverageMatrix: Array<Record<string, string>>;
	lookThrough: {
		status: string;
		illustrativeAllocation: Record<string, number>;
	};
	currentPrimaryReadback: {
		status: string;
		rakutenSox: {
			asOf: string;
			investmentCount: number;
			top10: Array<{ companyId?: string; weightPercent: number }>;
		};
		dram: { weightStatus: string };
		maxis221a: { status: string };
	};
	sources: Array<{ id: string; url: string }>;
	visualPlan: { formats: string[]; sourceDateOnScreen: boolean };
	openAcceptance: string[];
};

const ledger = fs.readJsonSync(
	"config/evidence/issue_130_semiconductor_funds_20260924.json",
) as EvidenceLedger;

describe("issue 130 evidence ledger", () => {
	test("records product definitions without promoting stale holdings to current", () => {
		expect(ledger.status).toBe("PARTIAL_UNVERIFIED");
		expect(ledger.products.map((product) => product.id)).toEqual([
			"dram",
			"221a",
			"rakuten_sox",
		]);
		expect(ledger.products[0]?.holdingsStatus).toBe("DATED_PARTIAL");
		expect(ledger.products[1]?.holdingsStatus).toBe("HISTORICAL_SAMPLE_ONLY");
		expect(ledger.products[2]?.holdingsStatus).toBe(
			"CURRENT_MONTHLY_TOP10_READBACK_PARTIAL",
		);
		expect(ledger.currentPrimaryReadback).toMatchObject({
			status: "PARTIAL_VERIFIED",
			rakutenSox: { asOf: "2026-08-31", investmentCount: 31 },
			dram: {
				weightStatus: "UNVERIFIED_PAGE_DOES_NOT_EXPOSE_NUMBERS_IN_READBACK",
			},
			maxis221a: { status: "UNVERIFIED_REQUIRES_CURRENT_MONTHLY_REPORT" },
		});
		expect(ledger.currentPrimaryReadback.rakutenSox.top10).toHaveLength(10);
	});

	test("keeps the complete 8 by 3 matrix and fail-closed look-through status", () => {
		expect(ledger.companies).toHaveLength(8);
		expect(ledger.coverageMatrix).toHaveLength(8);
		for (const row of ledger.coverageMatrix) {
			expect(row.companyId).toBeTruthy();
			expect([
				"UNVERIFIED_REQUIRES_LATEST_HOLDINGS",
				"SCOPE_ONLY_TOP_EXPOSURE_WEIGHT_UNVERIFIED",
			]).toContain(row.dram);
			expect(row["221a"]).toBe("UNVERIFIED_REQUIRES_LATEST_HOLDINGS");
		}
		expect(
			ledger.coverageMatrix.filter(
				(row) => row.rakuten_sox === "VERIFIED_TOP10_WEIGHT_2026-08-31",
			),
		).toHaveLength(6);
		expect(
			ledger.coverageMatrix.find((row) => row.companyId === "SKH")?.dram,
		).toBe("SCOPE_ONLY_TOP_EXPOSURE_WEIGHT_UNVERIFIED");
		expect(ledger.lookThrough.status).toBe(
			"NOT_CALCULABLE_UNTIL_CURRENT_HOLDINGS_ARE_VERIFIED",
		);
		expect(ledger.lookThrough.illustrativeAllocation).toMatchObject({
			dram: 25,
			"221a": 25,
			rakuten_sox: 50,
		});
	});

	test("preserves primary-source links and both delivery formats", () => {
		expect(ledger.sources.length).toBeGreaterThanOrEqual(4);
		for (const source of ledger.sources) {
			expect(source.url).toMatch(/^https:\/\//);
		}
		expect(ledger.visualPlan.formats).toEqual(["16:9", "9:16"]);
		expect(ledger.visualPlan.sourceDateOnScreen).toBe(true);
		expect(ledger.openAcceptance.length).toBeGreaterThanOrEqual(4);
	});
});
