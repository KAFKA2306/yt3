import { describe, expect, test } from "bun:test";
import { figureValueAppears } from "./explanation_contract.js";

describe("explanation quantities retain their complete value", () => {
	test("matches both endpoints and a single unit for a range", () => {
		const figure = { value: "18–24 months", unit: "months" };
		for (const text of ["18–24 months", "18-24 months", "18〜24 months"]) {
			expect(figureValueAppears(figure, [text])).toBe(true);
		}
		for (const text of [
			"18 months",
			"24 months",
			"18–36 months",
			"118–24 months",
			"18–24 years",
		]) {
			expect(figureValueAppears(figure, [text])).toBe(false);
		}
	});

	test("preserves magnitude words without duplicating an embedded unit", () => {
		for (const unit of ["fiber-kilometers", "million fiber-kilometers"]) {
			const figure = { value: "180 million fiber-kilometers", unit };
			expect(figureValueAppears(figure, ["180 million fiber-kilometers"])).toBe(
				true,
			);
			for (const text of [
				"180 fiber-kilometers",
				"180 billion fiber-kilometers",
				"180 million kilometers",
				"1180 million fiber-kilometers",
				"180 million fiber-kilometersSquared",
			]) {
				expect(figureValueAppears(figure, [text])).toBe(false);
			}
		}
	});

	test("appends units when the value carries only a number or range", () => {
		expect(
			figureValueAppears({ value: "18–24", unit: "months" }, ["18–24 months"]),
		).toBe(true);
		expect(
			figureValueAppears({ value: "180 million", unit: "fiber-kilometers" }, [
				"180 million fiber-kilometers",
			]),
		).toBe(true);
		expect(
			figureValueAppears({ value: "＋2.4％", unit: "%" }, [
				"プラス2.4パーセント",
			]),
		).toBe(true);
		expect(figureValueAppears({ value: "1,234", unit: "円" }, ["1234円"])).toBe(
			true,
		);
	});
});
