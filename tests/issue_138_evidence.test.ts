import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

type EvidenceLedger = {
	status: string;
	observedSnapshot: {
		uniqueTokyoCodes: number;
		individualStocks: number;
		individualStocksWithOverseasPrice: number;
		reconciliationStatus: string;
	};
	examples: Array<{ status: string; fallbackType: string }>;
	normalizationRules: string[];
	readbackBoundary: { status: string; requiredTabs: string[] };
	sources: Array<{ tier: string; url: string }>;
	visualPlan: { formats: string[]; sourceDateOnScreen: boolean };
	openAcceptance: string[];
};

const ledger = fs.readJsonSync(
	"config/evidence/issue_138_google_finance_fallback_20260924.json",
) as EvidenceLedger;

describe("issue 138 evidence ledger", () => {
	test("preserves the observed snapshot without presenting it as live data", () => {
		expect(ledger.status).toBe("PARTIAL_UNVERIFIED");
		expect(ledger.observedSnapshot.uniqueTokyoCodes).toBe(94);
		expect(ledger.observedSnapshot.individualStocks).toBe(74);
		expect(ledger.observedSnapshot.individualStocksWithOverseasPrice).toBe(62);
		expect(ledger.observedSnapshot.reconciliationStatus).toBe(
			"UNVERIFIED_REQUIRES_SHEET_READBACK",
		);
	});

	test("covers ADR, OTC, and European routes with normalization controls", () => {
		expect(ledger.examples).toHaveLength(5);
		expect(
			new Set(ledger.examples.map((example) => example.fallbackType)).size,
		).toBe(3);
		expect(
			ledger.examples.every((example) =>
				example.status.startsWith("UNVERIFIED_"),
			),
		).toBe(true);
		expect(ledger.normalizationRules).toHaveLength(5);
		expect(ledger.readbackBoundary.status).toBe(
			"UNVERIFIED_SHEET_ACCESS_REQUIRED",
		);
		expect(ledger.readbackBoundary.requiredTabs).toEqual([
			"Securities_Master",
			"ADR_Audit",
		]);
	});

	test("requires primary documentation and both delivery formats", () => {
		expect(ledger.sources).toHaveLength(5);
		expect(
			ledger.sources.filter((source) => source.tier === "L1"),
		).toHaveLength(4);
		expect(
			ledger.sources.every((source) => source.url.startsWith("https://")),
		).toBe(true);
		expect(ledger.visualPlan.formats).toEqual(["16:9", "9:16"]);
		expect(ledger.visualPlan.sourceDateOnScreen).toBe(true);
		expect(ledger.openAcceptance).toHaveLength(4);
	});
});
