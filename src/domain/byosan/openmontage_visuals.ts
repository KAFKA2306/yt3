import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { type ChartSpec, getByosanChartTheme } from "./charts.js";
import type { ByosanSceneRender } from "./scene_render.js";

export type OpenMontageSegment = {
	index: number;
	start: number;
	duration: number;
	headline: string;
	subheadline: string;
	render: ByosanSceneRender;
};

export type OpenMontageConfig = {
	dir: string;
	repo: string;
	ref: string;
	composition: string;
	crf: number;
};

type Cut = Record<string, unknown>;

function chartCut(chart: ChartSpec, title: string): Cut {
	if (chart.kind === "bignumber") {
		return {
			type: "stat_card",
			stat: `${chart.displayNumber ?? chart.value}${chart.unit}`,
			subtitle: chart.label,
		};
	}
	const labels = getByosanChartTheme().kind_labels;
	const categories = chart.kind === "line" ? chart.x : chart.categories;
	return {
		type: "bar_chart",
		title,
		showValues: true,
		chartData: categories.flatMap((category, i) =>
			chart.series.map((series) => ({
				label: `${category}（${labels[series.kind]}）`,
				value: series.values[i],
			})),
		),
	};
}

function cutFor(segment: OpenMontageSegment): Cut {
	const { render, headline, subheadline } = segment;
	if (render.kind === "chart") return chartCut(render.chart, headline);
	if (render.kind === "stat_cards") {
		const [first, second] = render.stats;
		if (render.stats.length === 1 && first) {
			return {
				type: "stat_card",
				stat: first.value,
				subtitle: `${first.label} ${first.detail}`,
			};
		}
		if (render.stats.length === 2 && first && second) {
			return {
				type: "comparison",
				title: headline,
				leftLabel: first.label,
				leftValue: first.value,
				rightLabel: second.label,
				rightValue: second.value,
			};
		}
		return {
			type: "callout",
			callout_type: "info",
			title: headline,
			text: render.stats.map((s) => `${s.label} ${s.value}`).join("\n"),
		};
	}
	if (segment.index === 0) {
		return { type: "hero_title", text: headline, heroSubtitle: subheadline };
	}
	return { type: "text_card", text: headline };
}

export function openMontageCuts(segments: OpenMontageSegment[]): Cut[] {
	return segments.map((segment) => ({
		id: `scene-${segment.index}`,
		source: "",
		in_seconds: segment.start,
		out_seconds: segment.start + segment.duration,
		...cutFor(segment),
	}));
}

export function renderOpenMontage(
	config: OpenMontageConfig,
	segments: OpenMontageSegment[],
	propsPath: string,
	outputPath: string,
): void {
	fs.outputJsonSync(propsPath, {
		cuts: openMontageCuts(segments),
		overlays: [],
		captions: [],
		audio: {},
	});
	const result = spawnSync(
		"npx",
		[
			"remotion",
			"render",
			"src/index.tsx",
			config.composition,
			path.resolve(outputPath),
			`--props=${path.resolve(propsPath)}`,
			"--codec=h264",
			`--crf=${config.crf}`,
			"--overwrite",
		],
		{
			cwd: path.join(config.dir, "remotion-composer"),
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		},
	);
	if (result.status !== 0) {
		throw new Error(
			`BYOSAN_OPENMONTAGE_RENDER_FAILED status=${result.status} ${(result.stderr ?? "").slice(-600)}`,
		);
	}
}
