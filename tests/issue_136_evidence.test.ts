import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

type EvidenceLedger = {
	status: string;
	companies: Array<{
		investmentRelation: string;
		instrument: string;
		marketData: string;
	}>;
	reportedFacts: Array<{ status: string; sourceIds: string[] }>;
	sources: Array<{ tier: string; url: string }>;
	marketDataBoundary: { status: string; requiredFields: string[] };
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
			"UNVERIFIED_REQUIRES_AUTHENTICATED_CURRENT_READBACK",
		);
		expect(ledger.marketDataBoundary.requiredFields).toHaveLength(5);
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
