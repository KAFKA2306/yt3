import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

type EvidenceLedger = {
	status: string;
	lossLayers: Array<{ id: string; status: string }>;
	marketForecastReadback: {
		status: string;
		readAt: string;
		usDataCenterPowerDemandGw: Record<string, number>;
		onTimeActivationForecast: { status: string };
	};
	projectJupiterReadback: {
		status: string;
		entries: Array<{
			sourceId: string;
			verifiedClaims: string[];
			boundary: string;
		}>;
	};
	sources: Array<{ tier: string; url: string }>;
	visualPlan: {
		formats: string[];
		sourceDateOnScreen: boolean;
		nonRecommendationLabel: boolean;
	};
	openAcceptance: string[];
};

const ledger = fs.readJsonSync(
	"config/evidence/issue_156_ai_datacenter_credit_risk_20260925.json",
) as EvidenceLedger;

describe("issue 156 evidence ledger", () => {
	test("separates the five loss layers and keeps unknown exposure explicit", () => {
		expect(ledger.status).toBe("PARTIAL_UNVERIFIED");
		expect(ledger.lossLayers).toHaveLength(5);
		expect(
			ledger.lossLayers.find((layer) => layer.id === "high_leverage_neocloud")
				?.status,
		).toBe("REQUIRES_ENTITY_SPECIFIC_CONTRACT_AND_POWER_READBACK");
	});

	test("records Goldman forecast values without turning them into facility actuals", () => {
		expect(ledger.marketForecastReadback.status).toBe(
			"VERIFIED_FORECAST_NOT_FACILITY_ACTUAL",
		);
		expect(ledger.marketForecastReadback.readAt).toBe("2026-09-25");
		expect(ledger.marketForecastReadback.usDataCenterPowerDemandGw).toEqual({
			"2025": 31,
			"2026": 41,
			"2027": 66,
		});
		expect(ledger.marketForecastReadback.onTimeActivationForecast.status).toBe(
			"FORECAST_RANGE",
		);
	});

	test("keeps Project Jupiter reporting distinct from default or realized loss", () => {
		expect(ledger.projectJupiterReadback.status).toBe(
			"PARTIAL_REPORTED_READBACK",
		);
		expect(ledger.projectJupiterReadback.entries).toHaveLength(2);
		expect(
			ledger.projectJupiterReadback.entries.every(
				(entry) => entry.verifiedClaims.length > 0 && entry.boundary.length > 0,
			),
		).toBe(true);
		expect(
			ledger.sources.every((source) => source.url.startsWith("https://")),
		).toBe(true);
	});

	test("preserves both delivery formats and the non-recommendation boundary", () => {
		expect(ledger.visualPlan.formats).toEqual(["16:9", "9:16"]);
		expect(ledger.visualPlan.sourceDateOnScreen).toBe(true);
		expect(ledger.visualPlan.nonRecommendationLabel).toBe(true);
		expect(ledger.openAcceptance).toHaveLength(4);
	});
});
