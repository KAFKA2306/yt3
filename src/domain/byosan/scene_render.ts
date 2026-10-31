import type { ChartSpec, SeriesKind } from "./charts.js";
import type { Explanation } from "./explanation.js";
import type {
	ByosanFeatureSegment,
	ByosanFeatureSpec,
} from "./feature_spec.js";
import type {
	ByosanSceneItem,
	ByosanSceneSpec,
	ByosanSceneValueRef,
	ByosanSceneVisual,
} from "./scene_spec.js";

export type ByosanRenderedStat = ByosanFeatureSegment["stats"][number];

export type ByosanSceneRender =
	| { kind: "question" }
	| { kind: "stat_cards"; stats: ByosanRenderedStat[] }
	| { kind: "chart"; chart: ChartSpec }
	| { kind: "none" };

type SceneSource = Pick<ByosanFeatureSpec, "claims" | "segments">;
type SceneExplanation = Pick<Explanation, "figures">;

type ResolvedValue = {
	display: string;
	detail: string;
	seriesName: string;
	kind: SeriesKind;
};

const NUMERIC_VALUE = /^([+\-−]?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\D*)$/u;

export function parseDisplayValue(
	display: string,
): { value: number; unit: string } | null {
	const match = NUMERIC_VALUE.exec(
		display.normalize("NFKC").replace(/\s+/gu, ""),
	);
	if (!match) return null;
	const [, sign = "", integer = "", fraction = "", unit = ""] = match;
	const magnitude = Number(`${integer.replaceAll(",", "")}${fraction}`);
	const negative = sign === "-" || sign === "−";
	return { value: negative ? -magnitude : magnitude, unit };
}

function segmentSeriesKind(
	source: SceneSource,
	segment: ByosanFeatureSegment,
): SeriesKind {
	const claimIds = segment.claimIds ?? [];
	const verified =
		claimIds.length > 0 &&
		claimIds.every((claimId) =>
			source.claims.some(
				(claim) => claim.id === claimId && claim.status === "verified",
			),
		);
	return verified ? "actual" : "estimate";
}

function statRef(
	source: SceneSource,
	ref: Extract<ByosanSceneValueRef, { source: "stat" }>,
): { segment: ByosanFeatureSegment; stat: ByosanRenderedStat } {
	const segment = source.segments[ref.segmentIndex];
	const stat = segment?.stats[ref.statIndex];
	if (!segment || !stat) {
		throw new Error(`BYOSAN_SCENE_VALUE_MISSING: ${JSON.stringify(ref)}`);
	}
	return { segment, stat };
}

function resolveValue(
	ref: ByosanSceneValueRef,
	source: SceneSource,
	explanation: SceneExplanation,
): ResolvedValue {
	if (ref.source === "stat") {
		const { segment, stat } = statRef(source, ref);
		return {
			display: stat.value,
			detail: stat.detail,
			seriesName: segment.subheadline,
			kind: segmentSeriesKind(source, segment),
		};
	}
	const figure = explanation.figures[ref.figureIndex];
	if (!figure) {
		throw new Error(`BYOSAN_SCENE_VALUE_MISSING: ${JSON.stringify(ref)}`);
	}
	return {
		display: figure.value,
		detail: figure.population,
		seriesName: figure.metric,
		kind: figure.kind,
	};
}

function numericSeries(
	items: ByosanSceneItem[],
	source: SceneSource,
	explanation: SceneExplanation,
) {
	const parsed = items.flatMap((item) => {
		const resolved = resolveValue(item.value, source, explanation);
		const numeric = parseDisplayValue(resolved.display);
		return numeric ? [{ label: item.label, ...resolved, ...numeric }] : [];
	});
	const first = parsed[0];
	if (!first || parsed.length !== items.length) return null;
	const mixed = parsed.some(
		(item) =>
			item.unit !== first.unit ||
			item.kind !== first.kind ||
			item.seriesName !== first.seriesName,
	);
	if (mixed) return null;
	const series = parsed;
	return {
		labels: series.map((item) => item.label),
		values: series.map((item) => item.value),
		displayValues: series.map((item) => item.display),
		unit: first.unit,
		kind: first.kind,
		seriesName: first.seriesName,
	};
}

function chartOf(
	visual: Extract<
		ByosanSceneVisual,
		{ kind: "bignumber" | "hbar_compare" | "bar_trend" | "line_series" }
	>,
	source: SceneSource,
	explanation: SceneExplanation,
): ChartSpec | null {
	switch (visual.kind) {
		case "bignumber": {
			const resolved = resolveValue(visual.value, source, explanation);
			const numeric = parseDisplayValue(resolved.display);
			return numeric
				? {
						kind: "bignumber",
						label: visual.label,
						sublabel: resolved.detail,
						displayNumber: resolved.display
							.normalize("NFKC")
							.replace(/\s+/gu, "")
							.slice(0, numeric.unit ? -numeric.unit.length : undefined),
						...numeric,
					}
				: null;
		}
		case "hbar_compare":
		case "bar_trend": {
			const series = numericSeries(visual.items, source, explanation);
			if (!series) return null;
			return {
				kind: visual.kind === "hbar_compare" ? "hbar" : "bar",
				categories: series.labels,
				series: [
					{
						name: series.seriesName,
						values: series.values,
						displayValues: series.displayValues,
						kind: series.kind,
					},
				],
				unit: series.unit,
			};
		}
		case "line_series": {
			const series = numericSeries(visual.items, source, explanation);
			if (!series) return null;
			return {
				kind: "line",
				x: series.labels,
				series: [
					{
						name: series.seriesName,
						values: series.values,
						displayValues: series.displayValues,
						kind: series.kind,
					},
				],
				unit: series.unit,
			};
		}
	}
}

function statCardsOf(
	items: ByosanSceneItem[],
	source: SceneSource,
): ByosanRenderedStat[] {
	return items.map((item) => {
		if (item.value.source !== "stat") {
			throw new Error(
				`BYOSAN_SCENE_STAT_REF_EXPECTED: ${JSON.stringify(item.value)}`,
			);
		}
		return statRef(source, item.value).stat;
	});
}

export function resolveSceneRender(
	scene: ByosanSceneSpec,
	source: SceneSource,
	explanation: SceneExplanation,
	continued: boolean,
): ByosanSceneRender {
	const { visual } = scene;
	if (visual.kind === "question") return { kind: "question" };
	if (continued) return { kind: "none" };
	if (visual.kind === "stat_cards") {
		return { kind: "stat_cards", stats: statCardsOf(visual.items, source) };
	}
	const chart = chartOf(visual, source, explanation);
	if (chart) return { kind: "chart", chart };
	const segment = source.segments[scene.segmentIndexes[0] ?? -1];
	if (!segment) {
		throw new Error(`BYOSAN_SCENE_SEGMENT_MISSING: ${scene.sceneId}`);
	}
	return { kind: "stat_cards", stats: segment.stats };
}
