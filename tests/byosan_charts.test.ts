import { describe, expect, test } from "bun:test";
import {
	type ChartSpec,
	getByosanChartTheme,
	renderChartSvg,
} from "../src/domain/byosan/charts.js";
import { getByosanVisualSystem } from "../src/domain/design/kafka_visual_system.js";

const theme = getByosanChartTheme();
const size = getByosanVisualSystem().landscape.data_region;

const hbar: ChartSpec = {
	kind: "hbar",
	categories: ["CPIコア", "日銀版コア", "タブレット端末"],
	series: [{ name: "前年同月比", values: [2.1, 2.4, 28.7], kind: "actual" }],
	unit: "%",
};

const bignumber: ChartSpec = {
	kind: "bignumber",
	value: 28.7,
	label: "タブレット端末（前年同月比）",
	unit: "%",
	sublabel: "2026年9月・実績",
};

const bar: ChartSpec = {
	kind: "bar",
	categories: ["2024", "2025", "2026"],
	series: [{ name: "総額", values: [10, 14, 18], kind: "actual" }],
	unit: "億円",
};

const line: ChartSpec = {
	kind: "line",
	x: ["1月", "2月", "3月"],
	series: [{ name: "指数", values: [100, 104, 110], kind: "actual" }],
	unit: "",
};

describe("byosan chart rendering", () => {
	test("rejects a series without values", () => {
		expect(() => renderChartSvg({ ...bar, series: [] }, theme, size)).toThrow();
	});

	test("rejects a series whose value count differs from the categories", () => {
		expect(() =>
			renderChartSvg(
				{ ...bar, series: [{ name: "総額", values: [10], kind: "actual" }] },
				theme,
				size,
			),
		).toThrow();
	});
});
