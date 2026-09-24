import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

type EvidenceLedger = {
	status: string;
	layers: Array<{ id: string; status: string }>;
	reportedKpis: Array<{ status: string; sourceIds: string[] }>;
	companyReadbacks: {
		status: string;
		readAt: string;
		entries: Array<{
			sourceId: string;
			verifiedClaims: string[];
			boundary: string;
		}>;
	};
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

	test("records the dated company readback without overstating bottleneck proof", () => {
		expect(ledger.companyReadbacks.status).toBe("PARTIAL_COMPANY_READBACK");
		expect(ledger.companyReadbacks.readAt).toBe("2026-09-25");
		expect(ledger.companyReadbacks.entries).toHaveLength(4);
		expect(
			ledger.companyReadbacks.entries.map((entry) => entry.sourceId),
		).toEqual([
			"nvidia_data_center",
			"tsmc_q2_2026",
			"asml_q2_2026",
			"broadcom_q2_2026",
		]);
		expect(
			ledger.companyReadbacks.entries.every(
				(entry) => entry.verifiedClaims.length > 0,
			),
		).toBe(true);
		expect(
			ledger.companyReadbacks.entries.every(
				(entry) => entry.boundary.length > 0,
			),
		).toBe(true);
	});

	test("preserves both delivery formats and unresolved acceptance", () => {
		expect(ledger.visualPlan.formats).toEqual(["16:9", "9:16"]);
		expect(ledger.visualPlan.sourceDateOnScreen).toBe(true);
		expect(ledger.openAcceptance).toHaveLength(4);
	});
});
