import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import yaml from "js-yaml";
import { z } from "zod";
import { getByosanChartTheme } from "../src/domain/byosan/charts.js";
import { ExplanationSchema } from "../src/domain/byosan/explanation.js";
import {
	ByosanFeatureClaimSchema,
	type ByosanFeatureSegment,
	ByosanFeatureSegmentSchema,
	type ByosanFeatureSpec,
} from "../src/domain/byosan/feature_spec.js";
import {
	BYOSAN_CONFIG_PATH,
	getByosanProductionConfig,
} from "../src/domain/byosan/production_config.js";
import {
	type ByosanSceneRender,
	parseDisplayValue,
	resolveSceneRender,
} from "../src/domain/byosan/scene_render.js";
import {
	ByosanScenesConfigSchema,
	compileScenes,
} from "../src/domain/byosan/scene_spec.js";
import {
	type SceneSvgStyle,
	renderSceneSvg,
} from "../src/domain/byosan/scene_svg.js";
import { resolveByosanVisualIdentity } from "../src/domain/byosan/visual_identity.js";
import { getByosanVisualSystem } from "../src/domain/design/kafka_visual_system.js";

const config = z
	.object({ scenes: ByosanScenesConfigSchema })
	.parse(
		yaml.load(fs.readFileSync("config/domains/byosan_money.yaml", "utf8")),
	).scenes;

const explanation = ExplanationSchema.parse({
	conclusion: "物価上昇は続いている。",
	principle: "品目別の上昇率は全体と分けて読む。",
	figures: [
		{
			metric: "全国CPIコア",
			population: "全国・生鮮食品を除く総合",
			period: "2026年7月",
			unit: "%",
			value: "+1.5%",
			quote: "7月は前年比+1.5%",
			kind: "actual",
		},
		{
			metric: "全国CPIコア",
			population: "全国・生鮮食品を除く総合",
			period: "2026年8月",
			unit: "%",
			value: "+1.7%",
			quote: "8月は前年比+1.7%",
			kind: "actual",
		},
		{
			metric: "全国CPIコア",
			population: "全国・生鮮食品を除く総合",
			period: "2026年9月",
			unit: "%",
			value: "+2.1%",
			quote: "9月は前年比+2.1%",
			kind: "actual",
		},
	],
	check: "次の公表値で確認する。",
});

const claims = [
	ByosanFeatureClaimSchema.parse({
		id: "c1",
		claim: "2026年9月の全国CPIコアは前年同月比+2.1%だった。",
		sourceIds: ["s1"],
		status: "verified",
	}),
	ByosanFeatureClaimSchema.parse({
		id: "c2",
		claim: "電気代の補助終了で11月以降の物価は上がる可能性がある。",
		sourceIds: ["s1"],
		status: "derived_with_caveat",
		caveat: "条件付きの見通し。",
		confidence: 0.7,
		unresolvedMismatches: [],
	}),
];

const stat = (label: string, value: string, detail: string) => ({
	label,
	value,
	detail,
	color: "cyan" as const,
});

const segments = [
	ByosanFeatureSegmentSchema.parse({
		speaker: "春日部つむぎ",
		emotion: "analytical",
		section: "月別の推移",
		headline: "3か月で上がった",
		subheadline: "全国の集計値",
		visualType: "推移",
		stats: [
			stat("7月", "+1.5%", "全国・前年同月比"),
			stat("8月", "+1.7%", "全国・前年同月比"),
			stat("9月", "+2.1%", "全国・前年同月比"),
		],
		source: "提示レポート",
		text: "七月から九月にかけて、前年比の上昇率が広がった。",
		claimIds: ["c1"],
	}),
	ByosanFeatureSegmentSchema.parse({
		speaker: "春日部つむぎ",
		emotion: "reveal",
		section: "品目の値上がり",
		headline: "タブレットは＋28.7％",
		subheadline: "品目の前年同月比",
		visualType: "数字",
		stats: [stat("タブレット端末", "+28.7%", "2026年9月・前年同月比")],
		source: "提示レポート",
		text: "タブレット端末は前年同月比で二十八点七パーセント上がった。",
		claimIds: ["c1"],
	}),
	ByosanFeatureSegmentSchema.parse({
		speaker: "ずんだもん",
		emotion: "curious",
		section: "比較",
		headline: "利益と売上を比べる",
		subheadline: "前年同期比の比較",
		visualType: "比較",
		stats: [
			stat("営業利益", "+43%", "前年同期比"),
			stat("AWS売上", "+28.8%", "前年同期比"),
		],
		source: "提示レポート",
		text: "営業利益とAWS売上を、同じ前年同期比の単位で並べて比べてみよう。",
		claimIds: ["c1"],
	}),
	ByosanFeatureSegmentSchema.parse({
		speaker: "ずんだもん",
		emotion: "curious",
		section: "問い",
		headline: "次は何を見る？",
		subheadline: "判断の順番を選ぶ",
		visualType: "問い",
		stats: [],
		source: "提示レポート",
		text: "次に何を確かめるかを、ひとつ選んで考えてみよう。",
		claimIds: ["c1"],
	}),
	ByosanFeatureSegmentSchema.parse({
		speaker: "春日部つむぎ",
		emotion: "analytical",
		section: "規模",
		headline: "売上と成長を並べる",
		subheadline: "単位の違う数字",
		visualType: "カード",
		stats: [stat("売上", "62.6億円", "四半期"), stat("成長", "+12%", "前年比")],
		source: "提示レポート",
		text: "売上は六十二億円、成長率は前年比十二パーセントだった。",
		claimIds: ["c1"],
	}),
	ByosanFeatureSegmentSchema.parse({
		speaker: "ずんだもん",
		emotion: "caution",
		section: "見通し",
		headline: "推計の比較",
		subheadline: "分析としての推計",
		visualType: "推計",
		stats: [
			stat("推計A", "+3.0%", "分析上の推計"),
			stat("推計B", "+4.0%", "分析上の推計"),
		],
		source: "提示レポート",
		text: "これは分析としての推計で、確定した実績ではない。",
		claimIds: ["c2"],
	}),
];

const spec: Pick<ByosanFeatureSpec, "claims" | "segments"> = {
	claims,
	segments,
};

const scenes = compileScenes(spec, explanation, config);

const style: SceneSvgStyle = {
	design: getByosanVisualSystem(),
	feature: getByosanProductionConfig().feature_production,
	identity: resolveByosanVisualIdentity(
		yaml.load(fs.readFileSync(BYOSAN_CONFIG_PATH, "utf8")),
	),
	chart: getByosanChartTheme(),
};

function segmentOf(index: number): ByosanFeatureSegment {
	const segment = segments[index];
	if (!segment) throw new Error(`segment ${index} missing`);
	return segment;
}

function renderOf(index: number, continued = false): ByosanSceneRender {
	const scene = scenes[index];
	if (!scene) throw new Error(`scene ${index} missing`);
	return resolveSceneRender(scene, spec, explanation, continued);
}

describe("byosan scene render", () => {
	test("assigns the SceneSpec kinds that the renderer draws", () => {
		expect(scenes.map((scene) => scene.visual.kind)).toEqual([
			"line_series",
			"bignumber",
			"hbar_compare",
			"question",
			"stat_cards",
			"hbar_compare",
		]);
	});

	test("draws a line from the referenced figures, with period labels and their values", () => {
		expect(renderOf(0)).toEqual({
			kind: "chart",
			chart: {
				kind: "line",
				x: ["2026年7月", "2026年8月", "2026年9月"],
				series: [
					{
						name: "全国CPIコア",
						values: [1.5, 1.7, 2.1],
						kind: "actual",
					},
				],
				unit: "%",
			},
		});
	});

	test("draws a big number from a stat, with its detail as the sublabel", () => {
		expect(renderOf(1)).toEqual({
			kind: "chart",
			chart: {
				kind: "bignumber",
				label: "タブレット端末",
				value: 28.7,
				unit: "%",
				sublabel: "2026年9月・前年同月比",
			},
		});
	});

	test("draws a horizontal comparison from stats that share one unit", () => {
		expect(renderOf(2)).toEqual({
			kind: "chart",
			chart: {
				kind: "hbar",
				categories: ["営業利益", "AWS売上"],
				series: [
					{
						name: "前年同期比の比較",
						values: [43, 28.8],
						kind: "actual",
					},
				],
				unit: "%",
			},
		});
	});

	test("keeps stats in separate cards when their units differ", () => {
		expect(renderOf(4)).toEqual({
			kind: "stat_cards",
			stats: segmentOf(4).stats,
		});
	});

	test("marks values from non-verified claims as estimates", () => {
		expect(renderOf(5)).toMatchObject({
			kind: "chart",
			chart: { kind: "hbar", series: [{ kind: "estimate", values: [3, 4] }] },
		});
	});

	test("keeps the question mark on a continued question part", () => {
		expect(renderOf(3, true)).toEqual({ kind: "question" });
	});

	test("draws no numeric figure on a continued part of a numeric scene", () => {
		expect(renderOf(0, true)).toEqual({ kind: "none" });
		expect(renderOf(1, true)).toEqual({ kind: "none" });
		expect(renderOf(4, true)).toEqual({ kind: "none" });
	});

	test("rejects a comparison that mixes units", () => {
		const scene = scenes[2];
		if (!scene) throw new Error("scene 2 missing");
		expect(() =>
			resolveSceneRender(
				{
					...scene,
					visual: {
						kind: "hbar_compare",
						items: [
							{
								label: "利益",
								value: { source: "stat", segmentIndex: 2, statIndex: 0 },
							},
							{
								label: "売上",
								value: { source: "stat", segmentIndex: 4, statIndex: 0 },
							},
						],
					},
				},
				spec,
				explanation,
				false,
			),
		).toThrow("BYOSAN_SCENE_SERIES_MIXED");
	});

	test("rejects a value reference that does not resolve", () => {
		const scene = scenes[1];
		if (!scene) throw new Error("scene 1 missing");
		expect(() =>
			resolveSceneRender(
				{
					...scene,
					visual: {
						kind: "bignumber",
						label: "存在しない",
						value: { source: "stat", segmentIndex: 99, statIndex: 0 },
					},
				},
				spec,
				explanation,
				false,
			),
		).toThrow("BYOSAN_SCENE_VALUE_MISSING");
	});

	test("reads signed, grouped and unit-suffixed display values", () => {
		expect(parseDisplayValue("＋2.1％")).toEqual({ value: 2.1, unit: "%" });
		expect(parseDisplayValue("−0.3%")).toEqual({ value: -0.3, unit: "%" });
		expect(parseDisplayValue("1,234億円")).toEqual({
			value: 1234,
			unit: "億円",
		});
	});

	test("rejects a display value without a leading number", () => {
		expect(() => parseDisplayValue("約3%")).toThrow(
			"BYOSAN_SCENE_VALUE_UNPARSEABLE",
		);
	});

	test("embeds the chart inside the configured data region", () => {
		const region = style.design.landscape.data_region;
		const svg = renderSceneSvg(
			{ segment: segmentOf(1), render: renderOf(1), index: 1, total: 6 },
			style,
		);
		expect(svg).toContain(`translate(${region.x},${region.y})`);
		expect(svg).toContain("<svg");
	});

	test("shows the big number, its unit and its label in the rendered chart", () => {
		const svg = renderSceneSvg(
			{ segment: segmentOf(1), render: renderOf(1), index: 1, total: 6 },
			style,
		);
		expect(svg).toContain("+28.7");
		expect(svg).toContain("%");
		expect(svg).toContain("タブレット端末");
		expect(svg).toContain("2026年9月・前年同月比");
	});

	test("shows every comparison value with its unit in the rendered chart", () => {
		const svg = renderSceneSvg(
			{ segment: segmentOf(2), render: renderOf(2), index: 2, total: 6 },
			style,
		);
		expect(svg).toContain("+43%");
		expect(svg).toContain("+28.8%");
		expect(svg).toContain("営業利益");
	});

	test("draws the question mark only for question renders", () => {
		const question = renderSceneSvg(
			{ segment: segmentOf(3), render: renderOf(3), index: 3, total: 6 },
			style,
		);
		const continued = renderSceneSvg(
			{ segment: segmentOf(1), render: renderOf(1, true), index: 1, total: 6 },
			style,
		);
		expect(question).toContain(">?</text>");
		expect(continued).not.toContain(">?</text>");
	});

	test("omits the data region content for a continued numeric part", () => {
		const region = style.design.landscape.data_region;
		const svg = renderSceneSvg(
			{ segment: segmentOf(0), render: renderOf(0, true), index: 0, total: 6 },
			style,
		);
		expect(svg).not.toContain(`translate(${region.x},${region.y})`);
	});
});
