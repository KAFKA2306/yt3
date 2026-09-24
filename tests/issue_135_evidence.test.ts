import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

type EvidenceLedger = {
	status: string;
	maturityMatrix: Array<{ stage: string; sourceIds: string[] }>;
	counterarguments: Array<{ status: string }>;
	sources: Array<{ tier: string; url: string }>;
	visualPlan: { formats: string[]; sourceDateOnScreen: boolean };
	openAcceptance: string[];
};

const ledger = fs.readJsonSync(
	"config/evidence/issue_135_silicon_photonics_cpo_20260924.json",
) as EvidenceLedger;

describe("issue 135 evidence ledger", () => {
	test("does not blend production, development, demonstration, and control", () => {
		expect(ledger.status).toBe("PARTIAL_UNVERIFIED");
		expect(ledger.maturityMatrix).toHaveLength(4);
		expect(ledger.maturityMatrix.map((item) => item.stage)).toEqual([
			"PRODUCTION_REPORTED",
			"TECHNOLOGY_DEVELOPMENT_REPORTED",
			"DEMONSTRATION_REPORTED",
			"PACKET_SWITCH_PRODUCTION_CONTROL",
		]);
	});

	test("keeps counterarguments explicitly unresolved", () => {
		expect(ledger.counterarguments).toHaveLength(4);
		expect(
			ledger.counterarguments.every((item) =>
				item.status.startsWith("UNVERIFIED_"),
			),
		).toBe(true);
	});

	test("requires dated primary links and both delivery formats", () => {
		expect(
			ledger.sources.filter((source) => source.tier === "L1"),
		).toHaveLength(5);
		expect(
			ledger.sources.every((source) => source.url.startsWith("https://")),
		).toBe(true);
		expect(ledger.visualPlan.formats).toEqual(["16:9", "9:16"]);
		expect(ledger.visualPlan.sourceDateOnScreen).toBe(true);
		expect(ledger.openAcceptance).toHaveLength(4);
	});
});
