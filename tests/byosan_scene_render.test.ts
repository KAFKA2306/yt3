import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import * as yaml from "js-yaml";
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
	test("marks values from non-verified claims as estimates", () => {
		expect(renderOf(5)).toMatchObject({
			kind: "chart",
			chart: { kind: "hbar", series: [{ kind: "estimate", values: [3, 4] }] },
		});
	});

	test("degrades a comparison that mixes units to stat cards", () => {
		const scene = scenes[2];
		if (!scene) throw new Error("scene 2 missing");
		expect(
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
		).toMatchObject({ kind: "stat_cards" });
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

	test("returns null for a display value without a leading number", () => {
		expect(parseDisplayValue("約3%")).toBeNull();
	});

	test("shrinks long single-line text to its box", () => {
		const segment = {
			...segmentOf(0),
			subheadline: "あ".repeat(60),
			stats: [],
		};
		const svg = renderSceneSvg(
			{ segment, render: renderOf(0), index: 0, total: 1 },
			style,
		);
		expect(svg).toContain('class="subheadline" style="font-size:21px"');
	});

	test("shrinks stat labels to the card width", () => {
		const stat = {
			label: "あ".repeat(40),
			value: "1%",
			detail: "前年比",
			color: "cyan" as const,
		};
		const segment = { ...segmentOf(0), stats: [stat, stat, stat] };
		const svg = renderSceneSvg(
			{
				segment,
				render: { kind: "stat_cards", stats: segment.stats },
				index: 0,
				total: 1,
			},
			style,
		);
		expect(svg).toContain('class="stat-label" style="font-size:7px"');
	});
});
