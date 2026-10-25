import { describe, expect, test } from "bun:test";
import { BYOSAN_ANGLE_SHAPE_EXAMPLE } from "../src/domain/agents/research.js";
import { ByosanAngleCandidateSchema } from "../src/domain/byosan/news_angle.js";

describe("byosan sharp-angle prompt contract", () => {
	test("the shape example embedded in the research prompt satisfies the candidate schema", () => {
		expect(
			ByosanAngleCandidateSchema.safeParse(BYOSAN_ANGLE_SHAPE_EXAMPLE).success,
		).toBe(true);
	});
});
