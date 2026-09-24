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
	currentSheetReadback: {
		status: string;
		tabs: {
			ADR_Audit: {
				auditedRows: number;
				adrSymbols: number;
				adrPriceSuccess: number;
				fallbackSymbols: number;
				fallbackPriceSuccess: number;
				stockRowsWithSuccessfulRoute: number;
			};
		};
		representativeQuotes: Array<{ status: string; price: number }>;
		formulaProof: { status: string; sampleCells: string[] };
	};
	followUpSheetReadback: {
		status: string;
		readAt: string;
		priceField: string;
		representativeAdrQuotes: Array<{
			canonicalId: string;
			price: number;
			status: string;
		}>;
		crossTabComparison: { status: string; examples: Array<unknown> };
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
			"CONTRADICTED_BY_CURRENT_SHEET_READBACK",
		);
	});

	test("records dated authenticated counts and five representative routes", () => {
		expect(ledger.currentSheetReadback.status).toBe(
			"VERIFIED_AUTHENTICATED_READBACK",
		);
		expect(ledger.currentSheetReadback.tabs.ADR_Audit).toMatchObject({
			auditedRows: 72,
			adrSymbols: 40,
			adrPriceSuccess: 38,
			fallbackSymbols: 26,
			fallbackPriceSuccess: 22,
			stockRowsWithSuccessfulRoute: 60,
		});
		expect(ledger.currentSheetReadback.representativeQuotes).toHaveLength(5);
		expect(
			ledger.currentSheetReadback.representativeQuotes.every(
				(quote) => quote.status === "ADR_OK" || quote.status === "FALLBACK_OK",
			),
		).toBe(true);
		expect(
			ledger.currentSheetReadback.representativeQuotes.map(
				(quote) => quote.price,
			),
		).toEqual([22.92, 164.55, 19.79, 34.74, 10.89]);
		expect(ledger.currentSheetReadback.formulaProof).toMatchObject({
			status: "VERIFIED_UI_FORMULA_READBACK",
			sampleCells: ["L14", "L36", "L38", "L49", "L55"],
		});
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
			"PARTIAL_VERIFIED_REQUIRES_RECONCILIATION",
		);
		expect(ledger.readbackBoundary.requiredTabs).toEqual([
			"Securities_Master",
			"ADR_Audit",
		]);
	});

	test("preserves the next-day readback as a separate dated snapshot", () => {
		expect(ledger.followUpSheetReadback).toMatchObject({
			status: "VERIFIED_AUTHENTICATED_READBACK",
			readAt: "2026-09-25",
			priceField: "adr_price",
			crossTabComparison: { status: "RECONCILIATION_REQUIRED" },
		});
		expect(ledger.followUpSheetReadback.representativeAdrQuotes).toHaveLength(
			5,
		);
		expect(
			ledger.followUpSheetReadback.representativeAdrQuotes.map(
				(quote) => quote.price,
			),
		).toEqual([22.88, 164.55, 19.74, 34.74, 10.87]);
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
