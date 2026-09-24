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
			"MONTHLY_REPORT_AVAILABLE_CURRENT_WEIGHTS_UNVERIFIED",
		);
	});

	test("keeps the complete 8 by 3 matrix and fail-closed look-through status", () => {
		expect(ledger.companies).toHaveLength(8);
		expect(ledger.coverageMatrix).toHaveLength(8);
		for (const row of ledger.coverageMatrix) {
			expect(row.companyId).toBeTruthy();
			expect(row.dram).toBe("UNVERIFIED_REQUIRES_LATEST_HOLDINGS");
			expect(row["221a"]).toBe("UNVERIFIED_REQUIRES_LATEST_HOLDINGS");
			expect(row.rakuten_sox).toBe("UNVERIFIED_REQUIRES_LATEST_HOLDINGS");
		}
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
