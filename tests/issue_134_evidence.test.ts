import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

type EvidenceLedger = {
	status: string;
	layers: Array<{ id: string; status: string; sourceIds: string[] }>;
	reportedFacts: Array<{ status: string; sourceIds: string[] }>;
	sources: Array<{ tier: string; url: string }>;
	visualPlan: { formats: string[]; sourceDateOnScreen: boolean };
	openAcceptance: string[];
};

const ledger = fs.readJsonSync(
	"config/evidence/issue_134_optical_switch_map_20260924.json",
) as EvidenceLedger;

describe("issue 134 evidence ledger", () => {
	test("keeps optical layers distinct", () => {
		expect(ledger.status).toBe("PARTIAL_UNVERIFIED");
		expect(ledger.layers).toHaveLength(4);
		expect(ledger.layers.map((layer) => layer.id)).toEqual([
			"packet_switch_asic",
			"optical_circuit_or_cpo_switch",
			"optical_transceiver",
			"materials_devices",
		]);
		for (const layer of ledger.layers) {
			expect(layer.sourceIds.length).toBeGreaterThan(0);
		}
	});

	test("labels company-reported facts and primary links", () => {
		expect(ledger.reportedFacts).toHaveLength(4);
		for (const fact of ledger.reportedFacts) {
			expect(fact.status).toMatch(/^VERIFIED_/);
			expect(fact.sourceIds.length).toBeGreaterThan(0);
		}
		expect(
			ledger.sources.filter((source) => source.tier === "L1"),
		).toHaveLength(6);
	});

	test("preserves both delivery formats and unresolved acceptance", () => {
		expect(ledger.visualPlan.formats).toEqual(["16:9", "9:16"]);
		expect(ledger.visualPlan.sourceDateOnScreen).toBe(true);
		expect(ledger.openAcceptance).toHaveLength(4);
	});
});
