import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

type EvidenceLedger = {
	status: string;
	layers: Array<{ id: string; sourceIds: string[] }>;
	metrics: Array<{
		basis: string;
		period: string;
		status: string;
		smallBaseWarning?: boolean;
	}>;
	sources: Array<{ tier: string; url: string }>;
	visualPlan: { formats: string[]; sourceDateOnScreen: boolean };
	openAcceptance: string[];
};

const ledger = fs.readJsonSync(
	"config/evidence/issue_137_ai_datacenter_growth_map_20260924.json",
) as EvidenceLedger;

describe("issue 137 evidence ledger", () => {
	test("keeps the infrastructure chain and metric bases explicit", () => {
		expect(ledger.status).toBe("PARTIAL_UNVERIFIED");
		expect(ledger.layers).toHaveLength(6);
		expect(ledger.metrics).toHaveLength(13);
		expect(ledger.metrics.some((metric) => metric.basis === "CAGR")).toBe(true);
		expect(
			ledger.metrics.some((metric) => metric.basis === "single_year_YoY"),
		).toBe(true);
		expect(
			ledger.metrics.some(
				(metric) => metric.basis === "demand_volume_not_revenue",
			),
		).toBe(true);
		expect(
			ledger.metrics.find((metric) => metric.smallBaseWarning)?.status,
		).toBe("PROVISIONAL_REQUIRES_PUBLISHER_READBACK");
	});

	test("keeps provisional market estimates from becoming verified facts", () => {
		expect(
			ledger.metrics.every((metric) =>
				metric.status.startsWith("PROVISIONAL_"),
			),
		).toBe(true);
		expect(ledger.sources).toHaveLength(7);
		expect(ledger.sources.every((source) => source.tier === "L1")).toBe(true);
		expect(
			ledger.sources.every((source) => source.url.startsWith("https://")),
		).toBe(true);
	});

	test("preserves delivery formats and unresolved acceptance", () => {
		expect(ledger.visualPlan.formats).toEqual(["16:9", "9:16"]);
		expect(ledger.visualPlan.sourceDateOnScreen).toBe(true);
		expect(ledger.openAcceptance).toHaveLength(4);
	});
});
