import { describe, expect, test } from "bun:test";
import { resolveResearchPromptContext } from "../src/domain/agents/research.js";

describe("Byosan blind discovery contract", () => {
	test("does not expose historical context before novelty audit", () => {
		const context = resolveResearchPromptContext(
			"byosan_money",
			"yesterday's topic and previous winner",
			"recent titles and analytics",
		);

		expect(context.promptMemory).toBe("");
		expect(context.promptThemes).toBe("");
		expect(context.memoryContext).toContain("historical content is excluded");
	});

	test("keeps historical context available for non-Byosan workflows", () => {
		const context = resolveResearchPromptContext(
			"humanity_observatory",
			"recent memory",
			"recent themes",
			process.cwd(),
		);

		expect(context.promptThemes).toBe("recent themes");
		expect(context.promptMemory).toContain("recent memory");
	});
});
