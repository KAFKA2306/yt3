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

export function parseDisplayValue(display: string): {
	value: number;
	unit: string;
} {
	const match = NUMERIC_VALUE.exec(
		display.normalize("NFKC").replace(/\s+/gu, ""),
	);
	if (!match) {
		throw new Error(`BYOSAN_SCENE_VALUE_UNPARSEABLE: ${display}`);
	}
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
	const parsed = items.map((item) => {
		const resolved = resolveValue(item.value, source, explanation);
		return {
			label: item.label,
			...resolved,
			...parseDisplayValue(resolved.display),
		};
	});
	const first = parsed[0];
	if (!first) {
		throw new Error("BYOSAN_SCENE_ITEMS_EMPTY");
	}
	const mixed = parsed.some(
		(item) =>
			item.unit !== first.unit ||
			item.kind !== first.kind ||
			item.seriesName !== first.seriesName,
	);
	if (mixed) {
		throw new Error(
			`BYOSAN_SCENE_SERIES_MIXED: ${parsed.map((item) => item.display).join(",")}`,
		);
	}
	return {
		labels: parsed.map((item) => item.label),
		values: parsed.map((item) => item.value),
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
): ChartSpec {
	switch (visual.kind) {
		case "bignumber": {
			const resolved = resolveValue(visual.value, source, explanation);
			return {
				kind: "bignumber",
				label: visual.label,
				sublabel: resolved.detail,
				...parseDisplayValue(resolved.display),
			};
		}
		case "hbar_compare": {
			const series = numericSeries(visual.items, source, explanation);
			return {
				kind: "hbar",
				categories: series.labels,
				series: [
					{ name: series.seriesName, values: series.values, kind: series.kind },
				],
				unit: series.unit,
			};
		}
		case "bar_trend": {
			const series = numericSeries(visual.items, source, explanation);
			return {
				kind: "bar",
				categories: series.labels,
				series: [
					{ name: series.seriesName, values: series.values, kind: series.kind },
				],
				unit: series.unit,
			};
		}
		case "line_series": {
			const series = numericSeries(visual.items, source, explanation);
			return {
				kind: "line",
				x: series.labels,
				series: [
					{ name: series.seriesName, values: series.values, kind: series.kind },
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
	switch (visual.kind) {
		case "stat_cards":
			return { kind: "stat_cards", stats: statCardsOf(visual.items, source) };
		case "bignumber":
		case "hbar_compare":
		case "bar_trend":
		case "line_series":
			return {
				kind: "chart",
				chart: chartOf(visual, source, explanation),
			};
	}
}
