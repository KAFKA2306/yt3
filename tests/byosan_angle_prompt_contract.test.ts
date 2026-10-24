import { describe, expect, test } from "bun:test";
import { BYOSAN_ANGLE_SHAPE_EXAMPLE } from "../src/domain/agents/research.js";
import {
	ByosanAngleCandidateSchema,
	evaluateByosanAngleCandidate,
} from "../src/domain/byosan/news_angle.js";

describe("byosan sharp-angle prompt contract", () => {
	test("the shape example embedded in the research prompt satisfies the candidate schema", () => {
		expect(
			ByosanAngleCandidateSchema.safeParse(BYOSAN_ANGLE_SHAPE_EXAMPLE).success,
		).toBe(true);
	});

	test("counterfactual without any marker fails the testability gate", () => {
		const evaluated = evaluateByosanAngleCandidate(
			{
				...BYOSAN_ANGLE_SHAPE_EXAMPLE,
				counterfactual:
					"もし政策の確信がより強ければ、市場は別の反応を示していた",
			},
			[],
		);
		expect(evaluated.hardGateFailures).toContain(
			"counterfactual_is_not_testable",
		);
	});
});
