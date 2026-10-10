import { describe, expect, test } from "bun:test";
import {
	BYOSAN_ANGLE_SHAPE_EXAMPLE,
	TrendScout,
} from "../src/domain/agents/research.js";
import {
	BYOSAN_COUNTERFACTUAL_TEST_MARKERS,
	ByosanAngleCandidateSchema,
	evaluateByosanAngleCandidate,
} from "../src/domain/byosan/news_angle.js";

const buildSharpAnglePrompt = (
	TrendScout.prototype as unknown as { buildSharpAnglePrompt(): string }
).buildSharpAnglePrompt;

describe("byosan sharp-angle prompt contract", () => {
	test("the shape example embedded in the research prompt satisfies the candidate schema", () => {
		expect(
			ByosanAngleCandidateSchema.safeParse(BYOSAN_ANGLE_SHAPE_EXAMPLE).success,
		).toBe(true);
	});

	test.each(BYOSAN_COUNTERFACTUAL_TEST_MARKERS)(
		"counterfactual containing marker %s passes the testability gate",
		(marker) => {
			const evaluated = evaluateByosanAngleCandidate(
				{
					...BYOSAN_ANGLE_SHAPE_EXAMPLE,
					counterfactual: `もし${marker}の条件を適用した場合、結論の数値は変わっていた`,
				},
				[],
			);
			expect(evaluated.hardGateFailures).not.toContain(
				"counterfactual_is_not_testable",
			);
		},
	);

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

	test("the research prompt lists every counterfactual marker the gate accepts", () => {
		const prompt = buildSharpAnglePrompt.call({});
		for (const marker of BYOSAN_COUNTERFACTUAL_TEST_MARKERS) {
			expect(prompt).toContain(marker);
		}
	});

	test("the research prompt restricts adversarial source ids to listed sources", () => {
		const prompt = buildSharpAnglePrompt.call({});
		expect(prompt).toContain(
			"sourceIds and checkedSourceIds must only reference ids listed in sources",
		);
	});
});
