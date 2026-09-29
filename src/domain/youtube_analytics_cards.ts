export interface CardMetricsQueryInput {
	channelId: string;
	videoId: string;
	startDate: string;
	endDate: string;
}

export interface CardMetrics {
	card_impressions: number | null;
	card_clicks: number | null;
	card_click_rate: number | null;
	card_teaser_impressions: number | null;
	card_teaser_clicks: number | null;
	card_teaser_click_rate: number | null;
}

const CARD_METRIC_COLUMNS = [
	["cardImpressions", "card_impressions"],
	["cardClicks", "card_clicks"],
	["cardClickRate", "card_click_rate"],
	["cardTeaserImpressions", "card_teaser_impressions"],
	["cardTeaserClicks", "card_teaser_clicks"],
	["cardTeaserClickRate", "card_teaser_click_rate"],
] as const;

function isCalendarDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return (
		Number.isFinite(parsed.getTime()) &&
		parsed.toISOString().slice(0, 10) === value
	);
}

export function buildCardMetricsQuery({
	channelId,
	videoId,
	startDate,
	endDate,
}: CardMetricsQueryInput) {
	const channel = channelId.trim();
	const video = videoId.trim();
	if (!channel || !video) {
		throw new Error("card-metrics query requires one channel and video id");
	}
	if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) {
		throw new Error("card-metrics query dates must use YYYY-MM-DD");
	}
	if (startDate > endDate) {
		throw new Error("card-metrics query startDate must not follow endDate");
	}
	return {
		ids: `channel==${channel}`,
		startDate,
		endDate,
		metrics: CARD_METRIC_COLUMNS.map(([name]) => name).join(","),
		filters: `video==${video}`,
	};
}

const EMPTY_CARD_METRICS: CardMetrics = {
	card_impressions: null,
	card_clicks: null,
	card_click_rate: null,
	card_teaser_impressions: null,
	card_teaser_clicks: null,
	card_teaser_click_rate: null,
};

function parseMetric(value: unknown, name: string): number | null {
	if (
		value === undefined ||
		value === null ||
		(typeof value === "string" && !value.trim())
	)
		return null;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(`Invalid ${name} value in card-metrics report`);
	}
	return parsed;
}

export function parseCardMetricsRow(
	columnHeaders: readonly { name?: string | null }[] | null | undefined,
	rows: readonly (readonly unknown[])[] | null | undefined,
): CardMetrics {
	if (!rows?.length) return { ...EMPTY_CARD_METRICS };
	if (rows.length !== 1) {
		throw new Error("Expected one aggregate row in card-metrics report");
	}
	const columns = new Map(
		(columnHeaders ?? []).map((header, index) => [header.name, index]),
	);
	for (const [apiName] of CARD_METRIC_COLUMNS) {
		if (!columns.has(apiName)) {
			throw new Error(
				`Missing required card-metrics report column: ${apiName}`,
			);
		}
	}
	const row = rows[0];
	if (!row) return { ...EMPTY_CARD_METRICS };
	const metrics = {} as CardMetrics;
	for (const [apiName, fieldName] of CARD_METRIC_COLUMNS) {
		const index = columns.get(apiName);
		if (index === undefined || index >= row.length) {
			throw new Error(`Missing ${apiName} value in card-metrics report row`);
		}
		metrics[fieldName] = parseMetric(row[index], apiName);
	}
	return metrics;
}
