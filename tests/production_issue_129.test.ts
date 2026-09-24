import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import { parseAndAuditByosanFeatureSpec } from "../src/domain/byosan/feature_spec.js";

const spec = parseAndAuditByosanFeatureSpec(
	fs.readJsonSync("config/productions/mitsui_nav_discount_20260924.json"),
);

describe("issue #129 production dossier", () => {
	test("keeps the NAV paradox source-backed and production-aware", () => {
		expect(spec.asOf).toBe("2026-09-24");
		expect(spec.production?.narrativeArchetype).toBe("paradox_resolution");
		expect(spec.segments.length).toBeGreaterThanOrEqual(20);
		expect(spec.sources.map((source) => source.id)).toEqual(
			expect.arrayContaining([
				"mitsuifudosan_ir2026",
				"cbre_tokyo_q2_2026",
				"boj_policy_20260918",
				"kabutan_8801_20260924",
			]),
		);
		expect(
			spec.claims.find((claim) => claim.id === "claim_discount")?.claim,
		).toContain("32.1%");
		expect(JSON.stringify(spec)).toContain("MF_NAV_Discount");
	});

	test("contains the required visual and non-recommendation boundaries", () => {
		const visualTypes = new Set(
			spec.segments.map((segment) => segment.visualType),
		);
		for (const visualType of [
			"timeline",
			"number-highlight",
			"bar-chart",
			"scenario-matrix",
		]) {
			expect(visualTypes.has(visualType)).toBe(true);
		}
		expect(spec.title).not.toMatch(/目標株価|買い場|絶好/);
		expect(spec.disclaimer).toContain("売買");
	});
});
