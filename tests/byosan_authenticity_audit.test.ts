import { describe, expect, test } from "bun:test";
import { auditAuthenticity } from "../src/domain/byosan/authenticity_audit.js";
import type { ByosanFeatureSpec } from "../src/domain/byosan/feature_spec.js";
import type { ByosanSceneSpec } from "../src/domain/byosan/scene_spec.js";

const featureSpec: Pick<ByosanFeatureSpec, "claims"> = {
	claims: [
		{
			id: "claim_a",
			claim: "売上は2.9％増えた",
			sourceIds: ["s1"],
			status: "verified",
		},
	],
};

const scene = (
	sceneId: string,
	claimIds: string[],
	prompt = "何が分かったか",
): ByosanSceneSpec => ({
	sceneId,
	segmentIndexes: [0],
	understandingGoal: "理解",
	claimIds,
	visual: { kind: "question", prompt },
	emphasis: { type: "none" },
	durationHint: 5,
});

describe("byosan authenticity audit", () => {
	test("passes when every scene cites a claim of the spec", () => {
		expect(
			auditAuthenticity({
				scenes: [scene("scene_00", ["claim_a"])],
				featureSpec,
			}),
		).toEqual({ status: "PASS", violations: [] });
	});

	test("fails when a scene cites a claim missing from the spec", () => {
		const result = auditAuthenticity({
			scenes: [scene("scene_00", ["claim_missing"])],
			featureSpec,
		});
		expect(result.status).toBe("FAIL");
		expect(result.violations.map((issue) => issue.code)).toEqual([
			"scene_claim_unverified",
		]);
	});

	test("fails when a scene exposes a third-party URL", () => {
		const result = auditAuthenticity({
			scenes: [scene("scene_00", ["claim_a"], "https://example.com/report")],
			featureSpec,
		});
		expect(result.status).toBe("FAIL");
		expect(result.violations.map((issue) => issue.code)).toEqual([
			"third_party_reference",
		]);
	});
});
