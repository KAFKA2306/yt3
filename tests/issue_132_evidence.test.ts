import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

type EvidenceLedger = {
	status: string;
	capitalRoles: Array<{ id: string; status: string }>;
	reportedFacts: Array<{ status: string; sourceIds: string[] }>;
	kpiMatrix: { status: string };
	tenfoldScenario: { status: string; prohibitedInference: string };
	sources: Array<{ tier: string; url: string }>;
	visualPlan: { formats: string[]; sourceDateOnScreen: boolean };
	openAcceptance: string[];
};

const ledger = fs.readJsonSync(
	"config/evidence/issue_132_autonomous_capital_20260924.json",
) as EvidenceLedger;

describe("issue 132 evidence ledger", () => {
	test("keeps four capital roles and comparable KPI work separate", () => {
		expect(ledger.status).toBe("PARTIAL_UNVERIFIED");
		expect(ledger.capitalRoles).toHaveLength(4);
		expect(ledger.reportedFacts).toHaveLength(4);
		for (const fact of ledger.reportedFacts) {
			expect(fact.status).toMatch(/^VERIFIED_/);
			expect(fact.sourceIds.length).toBeGreaterThan(0);
		}
		expect(ledger.kpiMatrix.status).toBe(
			"UNVERIFIED_REQUIRES_COMPARABLE_CURRENT_DATA",
		);
	});

	test("does not turn a tenfold scenario into a price claim", () => {
		expect(ledger.tenfoldScenario.status).toBe("SCENARIO_ONLY");
		expect(ledger.tenfoldScenario.prohibitedInference).toContain("share-price");
	});

	test("keeps primary links and both delivery formats", () => {
		expect(
			ledger.sources.filter((source) => source.tier === "L1"),
		).toHaveLength(6);
		expect(
			ledger.sources.every((source) => source.url.startsWith("https://")),
		).toBe(true);
		expect(ledger.visualPlan.formats).toEqual(["16:9", "9:16"]);
		expect(ledger.visualPlan.sourceDateOnScreen).toBe(true);
		expect(ledger.openAcceptance).toHaveLength(4);
	});
});
