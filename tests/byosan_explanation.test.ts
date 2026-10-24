import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import {
	type Explanation,
	auditExplanation,
} from "../src/domain/byosan/explanation.js";

const schema = JSON.parse(
	fs.readFileSync("config/schemas/byosan_explanation_v1.json", "utf8"),
);
const sentencePattern = new RegExp(schema.properties.conclusion.pattern);
const maxChars = 60;

const explanationWith = (conclusion: string): Explanation => ({
	conclusion,
	principle: "原則です。",
	figures: [],
	check: "確認です。",
});

describe("byosan explanation sentence limit", () => {
	test("schema pattern accepts a sentence at the limit and rejects one over it", () => {
		expect(sentencePattern.test(`${"あ".repeat(maxChars)}。`)).toBe(true);
		expect(sentencePattern.test(`${"あ".repeat(maxChars + 1)}。`)).toBe(false);
	});

	test("auditExplanation flags a sentence exactly when the schema pattern rejects it", () => {
		for (const length of [maxChars, maxChars + 1]) {
			const sentence = `${"あ".repeat(length)}。`;
			const flagged = auditExplanation(
				explanationWith(sentence),
				"",
				maxChars,
				[],
			).some((issue) => issue.startsWith("sentence_too_long"));
			expect(flagged).toBe(!sentencePattern.test(sentence));
		}
	});
});
