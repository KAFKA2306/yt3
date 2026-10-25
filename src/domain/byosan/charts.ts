import path from "node:path";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import fs from "fs-extra";
import { z } from "zod";

const BYOSAN_CHART_THEME_PATH = path.join(
	process.cwd(),
	"config/design/byosan_chart_v1.json",
);

const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const SizeSchema = z.number().positive();
const OffsetSchema = z.number().nonnegative();

type ChartSize = { width: number; height: number };

const ChartThemeSchema = z.object({
	palette: z.object({
		canvas: HexColorSchema,
		primary: HexColorSchema,
		text: HexColorSchema,
		text_muted: HexColorSchema,
		border: HexColorSchema,
		success: HexColorSchema,
		warning: HexColorSchema,
		danger: HexColorSchema,
	}),
	font_family: z.string().min(1),
	numeric_font_family: z.string().min(1),
	radius: OffsetSchema,
	stroke_width: SizeSchema,
	hairline_width: SizeSchema,
	hatch: z.object({
		gap: SizeSchema,
		width: SizeSchema,
		angle_degrees: z.number(),
	}),
	font_size: z.object({
		label: SizeSchema,
		axis: SizeSchema,
		legend: SizeSchema,
		bignumber_value: SizeSchema,
		bignumber_unit: SizeSchema,
		bignumber_label: SizeSchema,
		bignumber_sublabel: SizeSchema,
	}),
	font_weight: z.object({ regular: z.number().int(), bold: z.number().int() }),
	grid: z.object({
		left: OffsetSchema,
		right: OffsetSchema,
		top: OffsetSchema,
		bottom: OffsetSchema,
		hbar_label_room: OffsetSchema,
		bar_category_gap: z.string().min(1),
	}),
	legend: z.object({ top: OffsetSchema, right: OffsetSchema }),
	symbol_size: SizeSchema,
	bignumber: z.object({
		label_top: OffsetSchema,
		value_top: OffsetSchema,
		sublabel_top: OffsetSchema,
	}),
	kind_labels: z.object({
		actual: z.string().min(1),
		estimate: z.string().min(1),
		forecast: z.string().min(1),
	}),
});

export type ChartTheme = z.infer<typeof ChartThemeSchema>;

const SeriesKindSchema = z.enum(["actual", "estimate", "forecast"]);

export type SeriesKind = z.infer<typeof SeriesKindSchema>;

const SeriesSchema = z.object({
	name: z.string().min(1),
	values: z.array(z.number().finite()).min(1),
	kind: SeriesKindSchema,
});

const AxisLabelsSchema = z.array(z.string().min(1)).min(1);

const BarSpecSchema = z
	.object({
		kind: z.literal("bar"),
		categories: AxisLabelsSchema,
		series: z.array(SeriesSchema).min(1),
		unit: z.string(),
	})
	.refine(
		(spec) =>
			spec.series.every((s) => s.values.length === spec.categories.length),
		"series values must match categories",
	);

const HbarSpecSchema = z
	.object({
		kind: z.literal("hbar"),
		categories: AxisLabelsSchema,
		series: z.array(SeriesSchema).min(1),
		unit: z.string(),
	})
	.refine(
		(spec) =>
			spec.series.every((s) => s.values.length === spec.categories.length),
		"series values must match categories",
	);

const LineSpecSchema = z
	.object({
		kind: z.literal("line"),
		x: AxisLabelsSchema,
		series: z.array(SeriesSchema).min(1),
		unit: z.string(),
	})
	.refine(
		(spec) => spec.series.every((s) => s.values.length === spec.x.length),
		"series values must match x",
	);

const BignumberSpecSchema = z.object({
	kind: z.literal("bignumber"),
	value: z.number().finite(),
	label: z.string().min(1),
	unit: z.string(),
	sublabel: z.string().min(1),
});

const ChartSpecSchema = z.discriminatedUnion("kind", [
	BarSpecSchema,
	HbarSpecSchema,
	LineSpecSchema,
	BignumberSpecSchema,
]);

export type ChartSpec = z.infer<typeof ChartSpecSchema>;

type Series = z.infer<typeof SeriesSchema>;

export function getByosanChartTheme(): ChartTheme {
	return ChartThemeSchema.parse(fs.readJsonSync(BYOSAN_CHART_THEME_PATH));
}

const numberFormat = new Intl.NumberFormat("ja-JP", {
	maximumFractionDigits: 2,
	signDisplay: "exceptZero",
});

function formatValue(value: number, unit: string): string {
	return `${numberFormat.format(value)}${unit}`;
}

function seriesLabel(series: Series, theme: ChartTheme): string {
	return `${series.name} ${theme.kind_labels[series.kind]}`;
}

function kindItemStyle(
	kind: SeriesKind,
	theme: ChartTheme,
	borderRadius: number[],
) {
	const { palette } = theme;
	switch (kind) {
		case "actual":
			return { color: palette.primary, borderRadius };
		case "estimate":
			return {
				color: palette.canvas,
				borderRadius,
				borderColor: palette.primary,
				borderWidth: theme.hairline_width,
				decal: {
					symbol: "rect",
					symbolSize: theme.hatch.width,
					dashArrayX: [theme.hatch.gap, theme.hatch.gap],
					dashArrayY: [theme.hatch.gap, theme.hatch.gap],
					rotation: (theme.hatch.angle_degrees * Math.PI) / 180,
					color: palette.primary,
				},
			};
		case "forecast":
			return {
				color: palette.canvas,
				borderRadius,
				borderColor: palette.primary,
				borderWidth: theme.stroke_width,
				borderType: "dashed" as const,
			};
	}
}

function lineStyle(kind: SeriesKind, theme: ChartTheme) {
	const type = {
		actual: "solid",
		estimate: "dotted",
		forecast: "dashed",
	} as const;
	return {
		color: theme.palette.primary,
		width: theme.stroke_width,
		type: type[kind],
	};
}

function legendOption(names: string[], theme: ChartTheme) {
	return {
		top: theme.legend.top,
		right: theme.legend.right,
		data: names,
		textStyle: {
			color: theme.palette.text_muted,
			fontSize: theme.font_size.legend,
			fontFamily: theme.font_family,
		},
	};
}

function valueLabel(theme: ChartTheme, position: "top" | "right") {
	return {
		show: true,
		position,
		color: theme.palette.text,
		fontSize: theme.font_size.label,
		fontWeight: theme.font_weight.bold,
		fontFamily: theme.numeric_font_family,
	};
}

function axisLabel(theme: ChartTheme) {
	return {
		color: theme.palette.text,
		fontSize: theme.font_size.axis,
		fontWeight: theme.font_weight.regular,
		fontFamily: theme.font_family,
	};
}

function axisLine(theme: ChartTheme) {
	return {
		lineStyle: { color: theme.palette.border, width: theme.hairline_width },
	};
}

function barOption(
	spec: Extract<ChartSpec, { kind: "bar" }>,
	theme: ChartTheme,
): EChartsOption {
	const r = theme.radius;
	return {
		animation: false,
		backgroundColor: theme.palette.canvas,
		legend: legendOption(
			spec.series.map((s) => seriesLabel(s, theme)),
			theme,
		),
		grid: {
			left: theme.grid.left,
			right: theme.grid.right,
			top: theme.grid.top,
			bottom: theme.grid.bottom,
			containLabel: true,
		},
		xAxis: {
			type: "category",
			data: spec.categories,
			axisLine: axisLine(theme),
			axisTick: { show: false },
			axisLabel: axisLabel(theme),
		},
		yAxis: { type: "value", show: false },
		series: spec.series.map((series) => ({
			name: seriesLabel(series, theme),
			type: "bar",
			barCategoryGap: theme.grid.bar_category_gap,
			data: series.values.map((value) => ({
				value,
				label: { formatter: formatValue(value, spec.unit) },
			})),
			itemStyle: kindItemStyle(series.kind, theme, [r, r, 0, 0]),
			label: valueLabel(theme, "top"),
		})),
	};
}

function hbarOption(
	spec: Extract<ChartSpec, { kind: "hbar" }>,
	theme: ChartTheme,
): EChartsOption {
	const r = theme.radius;
	return {
		animation: false,
		backgroundColor: theme.palette.canvas,
		legend: legendOption(
			spec.series.map((s) => seriesLabel(s, theme)),
			theme,
		),
		grid: {
			left: theme.grid.left,
			right: theme.grid.hbar_label_room,
			top: theme.grid.top,
			bottom: theme.grid.bottom,
			containLabel: true,
		},
		xAxis: { type: "value", show: false },
		yAxis: {
			type: "category",
			data: spec.categories,
			inverse: true,
			axisLine: axisLine(theme),
			axisTick: { show: false },
			axisLabel: axisLabel(theme),
		},
		series: spec.series.map((series) => ({
			name: seriesLabel(series, theme),
			type: "bar",
			barCategoryGap: theme.grid.bar_category_gap,
			data: series.values.map((value) => ({
				value,
				label: { formatter: formatValue(value, spec.unit) },
			})),
			itemStyle: kindItemStyle(series.kind, theme, [0, r, r, 0]),
			label: valueLabel(theme, "right"),
		})),
	};
}

function lineOption(
	spec: Extract<ChartSpec, { kind: "line" }>,
	theme: ChartTheme,
): EChartsOption {
	return {
		animation: false,
		backgroundColor: theme.palette.canvas,
		legend: legendOption(
			spec.series.map((s) => seriesLabel(s, theme)),
			theme,
		),
		grid: {
			left: theme.grid.left,
			right: theme.grid.right,
			top: theme.grid.top,
			bottom: theme.grid.bottom,
			containLabel: true,
		},
		xAxis: {
			type: "category",
			data: spec.x,
			axisLine: axisLine(theme),
			axisTick: { show: false },
			axisLabel: axisLabel(theme),
		},
		yAxis: { type: "value", show: false },
		series: spec.series.map((series) => ({
			name: seriesLabel(series, theme),
			type: "line",
			symbol: "circle",
			symbolSize: theme.symbol_size,
			lineStyle: lineStyle(series.kind, theme),
			itemStyle: {
				color:
					series.kind === "actual"
						? theme.palette.primary
						: theme.palette.canvas,
				borderColor: theme.palette.primary,
				borderWidth: theme.stroke_width,
			},
			data: series.values.map((value) => ({
				value,
				label: { formatter: formatValue(value, spec.unit) },
			})),
			label: valueLabel(theme, "top"),
		})),
	};
}

function bignumberOption(
	spec: Extract<ChartSpec, { kind: "bignumber" }>,
	theme: ChartTheme,
): EChartsOption {
	const { font_size: size, font_weight: weight, bignumber: layout } = theme;
	return {
		animation: false,
		backgroundColor: theme.palette.canvas,
		series: [],
		graphic: {
			elements: [
				{
					type: "text",
					left: "center",
					top: layout.label_top,
					style: {
						text: spec.label,
						fontSize: size.bignumber_label,
						fontWeight: weight.bold,
						fontFamily: theme.font_family,
						fill: theme.palette.text,
					},
				},
				{
					type: "text",
					left: "center",
					top: layout.value_top,
					style: {
						text: `{value|${numberFormat.format(spec.value)}}{unit|${spec.unit}}`,
						rich: {
							value: {
								fontSize: size.bignumber_value,
								fontWeight: weight.bold,
								fontFamily: theme.numeric_font_family,
								fill: theme.palette.primary,
							},
							unit: {
								fontSize: size.bignumber_unit,
								fontWeight: weight.bold,
								fontFamily: theme.numeric_font_family,
								fill: theme.palette.primary,
							},
						},
					},
				},
				{
					type: "text",
					left: "center",
					top: layout.sublabel_top,
					style: {
						text: spec.sublabel,
						fontSize: size.bignumber_sublabel,
						fontWeight: weight.regular,
						fontFamily: theme.font_family,
						fill: theme.palette.text_muted,
					},
				},
			],
		},
	};
}

function buildOption(spec: ChartSpec, theme: ChartTheme): EChartsOption {
	switch (spec.kind) {
		case "bar":
			return barOption(spec, theme);
		case "hbar":
			return hbarOption(spec, theme);
		case "line":
			return lineOption(spec, theme);
		case "bignumber":
			return bignumberOption(spec, theme);
	}
}

export function renderChartSvg(
	spec: unknown,
	theme: ChartTheme,
	size: ChartSize,
): string {
	const parsed = ChartSpecSchema.parse(spec);
	const chart = echarts.init(null, null, {
		renderer: "svg",
		ssr: true,
		width: size.width,
		height: size.height,
	});
	chart.setOption(buildOption(parsed, theme));
	const svg = chart.renderToSVGString();
	chart.dispose();
	return svg;
}
