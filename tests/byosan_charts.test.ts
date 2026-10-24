import { describe, expect, test } from "bun:test";
import {
	type ChartSpec,
	getByosanChartTheme,
	renderChartSvg,
} from "../src/domain/byosan/charts.js";

const theme = getByosanChartTheme();

const bar: ChartSpec = {
	kind: "bar",
	categories: ["2024", "2025", "2026"],
	series: [{ name: "総額", values: [10, 14, 18], kind: "actual" }],
	unit: "億円",
};

describe("byosan chart numeric validation", () => {
	test("rejects a series without values", () => {
		expect(() => renderChartSvg({ ...bar, series: [] }, theme)).toThrow();
	});

	test("rejects a series whose value count differs from the categories", () => {
		expect(() =>
			renderChartSvg(
				{ ...bar, series: [{ name: "総額", values: [10], kind: "actual" }] },
				theme,
			),
		).toThrow();
	});
});
