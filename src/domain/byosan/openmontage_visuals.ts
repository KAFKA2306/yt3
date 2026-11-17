import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { getByosanVisualSystem } from "../design/kafka_visual_system.js";
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

const DESIGN = getByosanVisualSystem();

function byosanThemeConfig(): Record<string, unknown> {
	const { colors, typography } = DESIGN;
	return {
		primaryColor: colors.brand_blue,
		accentColor: colors.accent_primary,
		backgroundColor: colors.background,
		surfaceColor: colors.surface,
		textColor: colors.text_primary,
		mutedTextColor: colors.text_muted,
		headingFont: typography.display,
		bodyFont: typography.body,
		monoFont: typography.numeric,
		chartColors: [
			colors.brand_blue,
			colors.accent_primary,
			colors.accent_secondary,
			colors.warning,
			colors.success,
			colors.alert,
		],
		captionHighlightColor: colors.accent_primary,
		captionBackgroundColor: "rgba(255, 255, 255, 0.9)",
	};
}

function chartCut(chart: ChartSpec, title: string): Cut {
	if (chart.kind === "bignumber") {
		return {
			type: "stat_card",
			stat: `${chart.displayNumber ?? chart.value}${chart.unit}`,
			subtitle: chart.label,
			backgroundColor: DESIGN.colors.text_primary,
		};
	}
	if (
		chart.kind !== "line" &&
		chart.series.some((series) => series.values.some((value) => value < 0))
	) {
		const labels = getByosanChartTheme().kind_labels;
		return {
			type: "callout",
			callout_type: "info",
			title,
			text: chart.categories
				.map((category, index) => {
					const values = chart.series.flatMap((series) => {
						const value = series.values[index];
						if (value === undefined) return [];
						return [
							`${category}：${series.displayValues?.[index] ?? `${value}${chart.unit}`}（${labels[series.kind]}）`,
						];
					});
					return values.join("／");
				})
				.join("\n"),
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
				backgroundColor: DESIGN.colors.text_primary,
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
	const cuts: Cut[] = [];
	for (const segment of segments) {
		const outSeconds = segment.start + segment.duration;
		if (segment.render.kind === "none") {
			const previous = cuts.at(-1);
			if (previous) previous.out_seconds = outSeconds;
			continue;
		}
		const next: Cut = {
			id: `scene-${segment.index}`,
			source: "",
			in_seconds: segment.start,
			out_seconds: outSeconds,
			...cutFor(segment),
		};
		const previous = cuts.at(-1);
		if (previous && sameCutContent(previous, next)) {
			previous.out_seconds = outSeconds;
			continue;
		}
		cuts.push(next);
	}
	return cuts;
}

function sameCutContent(a: Cut, b: Cut): boolean {
	if (a.type === "hero_title" && b.type === "text_card" && a.text === b.text) {
		return true;
	}
	const visual = (cut: Cut): string => {
		const content = { ...cut };
		delete content.id;
		delete content.in_seconds;
		delete content.out_seconds;
		return JSON.stringify(content);
	};
	return visual(a) === visual(b);
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
		themeConfig: byosanThemeConfig(),
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
