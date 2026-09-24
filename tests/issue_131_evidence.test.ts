import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

type EvidenceLedger = {
	status: string;
	layers: Array<{ id: string; status: string }>;
	reportedKpis: Array<{ status: string; sourceIds: string[] }>;
	sources: Array<{ tier: string; url: string }>;
	visualPlan: { formats: string[]; sourceDateOnScreen: boolean };
	openAcceptance: string[];
};

const ledger = fs.readJsonSync(
	"config/evidence/issue_131_ai_infrastructure_20260924.json",
) as EvidenceLedger;

describe("issue 131 evidence ledger", () => {
	test("keeps six infrastructure layers and separates unknown facility layers", () => {
		expect(ledger.status).toBe("PARTIAL_UNVERIFIED");
		expect(ledger.layers).toHaveLength(6);
		expect(ledger.layers.find((layer) => layer.id === "power")?.status).toBe(
			"UNVERIFIED_REQUIRES_EXTERNAL_POWER_DATA",
		);
		expect(
			ledger.layers.find((layer) => layer.id === "cooling_datacenter")?.status,
		).toBe("UNVERIFIED_REQUIRES_EXTERNAL_FACILITY_DATA");
	});

	test("labels reported KPI periods and primary sources", () => {
		expect(ledger.reportedKpis).toHaveLength(3);
		for (const kpi of ledger.reportedKpis) {
			expect(kpi.status).toMatch(/^VERIFIED_/);
			expect(kpi.sourceIds.length).toBeGreaterThan(0);
		}
		expect(ledger.sources.every((source) => source.tier === "L1")).toBe(true);
		expect(
			ledger.sources.every((source) => source.url.startsWith("https://")),
		).toBe(true);
	});

	test("preserves both delivery formats and unresolved acceptance", () => {
		expect(ledger.visualPlan.formats).toEqual(["16:9", "9:16"]);
		expect(ledger.visualPlan.sourceDateOnScreen).toBe(true);
		expect(ledger.openAcceptance).toHaveLength(4);
	});
});
