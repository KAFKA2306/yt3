import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import {
	BYOSAN_EDITORIAL_REFERENCES,
	auditByosanEditorialReferencePlan,
	selectByosanEditorialReferencePlan,
} from "../src/domain/byosan/editorial_references.js";
import {
	auditByosanFeatureSpec,
	parseAndAuditByosanFeatureSpec,
	staticSceneMotionFilter,
} from "../src/domain/byosan/feature_spec.js";

const SPEC_PATH = "config/productions/sp500_anthropic_2026q2.json";

describe("byosan feature specification", () => {
	test("the reference production satisfies the reusable schema", async () => {
		const spec = parseAndAuditByosanFeatureSpec(await fs.readJson(SPEC_PATH));
		expect(spec.segments.length).toBeGreaterThanOrEqual(20);
		expect(auditByosanFeatureSpec(spec)).toEqual([]);
	});

	test("keeps twelve editorial references separate from factual sources", () => {
		expect(BYOSAN_EDITORIAL_REFERENCES).toHaveLength(12);
		expect(
			new Set(BYOSAN_EDITORIAL_REFERENCES.map((reference) => reference.id))
				.size,
		).toBe(12);
		const planA = selectByosanEditorialReferencePlan(
			"byosan_money/2026-09-23-daily",
			"power demand and AI capex",
		);
		const planB = selectByosanEditorialReferencePlan(
			"byosan_money/2026-09-24-daily",
			"power demand and AI capex",
		);
		expect(planA.selectedReferences.length).toBeGreaterThanOrEqual(3);
		expect(planA.selectedReferences.length).toBeLessThanOrEqual(5);
		expect(
			new Set(planA.selectedReferences.map((reference) => reference.roleGroup))
				.size,
		).toBeGreaterThanOrEqual(3);
		expect(
			planA.selectedReferences.map((reference) => reference.referenceId),
		).not.toEqual(
			planB.selectedReferences.map((reference) => reference.referenceId),
		);
		expect(auditByosanEditorialReferencePlan(planA)).toEqual(planA);
	});

	test("rejects an editorial reference used as a factual claim source", async () => {
		const spec = await fs.readJson(SPEC_PATH);
		const firstClaim = spec.claims[0];
		if (!firstClaim) throw new Error("reference fixture must contain a claim");
		const invalid = {
			...spec,
			claims: [
				{ ...firstClaim, sourceIds: ["ref_fred"] },
				...spec.claims.slice(1),
			],
		};
		expect(() => parseAndAuditByosanFeatureSpec(invalid)).toThrow(
			"editorial_reference_used_as_fact_source",
		);
	});

	test("motion policy renders static scenes without camera transforms", () => {
		const filter = staticSceneMotionFilter();
		expect(filter).toBe("fps=30");
		expect(filter).not.toMatch(/zoompan|crop|rotate|sin|cos/);
	});

	test("static scene motion filter rejects invalid frame rates", () => {
		expect(() => staticSceneMotionFilter(0)).toThrow(
			"Invalid static scene fps",
		);
	});
});
