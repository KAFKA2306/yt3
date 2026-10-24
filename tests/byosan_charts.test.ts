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
	test("renders an SVG document for every chart kind", () => {
		for (const spec of [hbar, bignumber, bar, line]) {
			const svg = renderChartSvg(spec, theme, size);
			expect(svg.startsWith("<svg")).toBe(true);
			expect(svg.endsWith("</svg>")).toBe(true);
		}
	});

	test("shows every bar and line value as a labelled number with its unit", () => {
		const hbarSvg = renderChartSvg(hbar, theme, size);
		expect(hbarSvg).toContain("+2.1%");
		expect(hbarSvg).toContain("+2.4%");
		expect(hbarSvg).toContain("+28.7%");
		expect(renderChartSvg(bar, theme, size)).toContain("+18億円");
		expect(renderChartSvg(line, theme, size)).toContain("+110");
	});

	test("shows the big number with its unit, label and sublabel", () => {
		const svg = renderChartSvg(bignumber, theme, size);
		expect(svg).toContain("+28.7");
		expect(svg).toContain("%");
		expect(svg).toContain("タブレット端末（前年同月比）");
		expect(svg).toContain("2026年9月・実績");
	});

	test("distinguishes estimate series with a hatch pattern and forecast series with a dashed outline", () => {
		const actualSvg = renderChartSvg(bar, theme, size);
		const estimateSvg = renderChartSvg(
			{
				...bar,
				series: [{ name: "総額", values: [10, 14, 18], kind: "estimate" }],
			},
			theme,
			size,
		);
		const forecastSvg = renderChartSvg(
			{
				...bar,
				series: [{ name: "総額", values: [10, 14, 18], kind: "forecast" }],
			},
			theme,
			size,
		);
		expect(actualSvg).not.toContain("<pattern");
		expect(estimateSvg).toContain("<pattern");
		expect(forecastSvg).not.toContain("<pattern");
		expect(forecastSvg).toContain("stroke-dasharray");
		expect(actualSvg).not.toContain("stroke-dasharray");
	});

	test("contains no gradients, filters or shadows", () => {
		for (const spec of [hbar, bignumber, bar, line]) {
			const svg = renderChartSvg(spec, theme, size);
			expect(svg).not.toContain("linearGradient");
			expect(svg).not.toContain("radialGradient");
			expect(svg).not.toContain("<filter");
			expect(svg).not.toContain("feDropShadow");
		}
	});

	test("takes colors from the injected theme", () => {
		const custom = {
			...theme,
			palette: { ...theme.palette, primary: "#123456" },
		};
		const svg = renderChartSvg(hbar, custom, size);
		expect(svg).toContain("#123456");
		expect(svg).not.toContain("#2563EB");
	});

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

	test("rejects an unknown chart kind", () => {
		expect(() =>
			renderChartSvg({ kind: "pie", value: 1 }, theme, size),
		).toThrow();
	});
});
