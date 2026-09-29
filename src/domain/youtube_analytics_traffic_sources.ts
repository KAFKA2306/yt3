export interface TrafficSourceQueryInput {
	channelId: string;
	videoId: string;
	startDate: string;
	endDate: string;
}

export interface TrafficSourceMetrics {
	traffic_source_type: string;
	views: number | null;
	engaged_views: number | null;
	watch_time_minutes: number | null;
}

export function buildTrafficSourceQuery({
	channelId,
	videoId,
	startDate,
	endDate,
}: TrafficSourceQueryInput) {
	return {
		ids: `channel==${channelId}`,
		startDate,
		endDate,
		metrics: "views,engagedViews,estimatedMinutesWatched",
		dimensions: "insightTrafficSourceType",
		filters: `video==${videoId}`,
	};
}

function parseMetric(value: unknown, name: string): number | null {
	if (
		value === undefined ||
		value === null ||
		(typeof value === "string" && !value.trim())
	)
		return null;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(`Invalid ${name} value in traffic-source report`);
	}
	return parsed;
}

export function parseTrafficSourceRows(
	columnHeaders: readonly { name?: string | null }[] | null | undefined,
	rows: readonly unknown[][] | null | undefined,
): TrafficSourceMetrics[] {
	if (!rows?.length) return [];
	const columns = new Map(
		(columnHeaders ?? []).map((header, index) => [header.name, index]),
	);
	const required = [
		"insightTrafficSourceType",
		"views",
		"engagedViews",
		"estimatedMinutesWatched",
	] as const;
	for (const name of required) {
		if (!columns.has(name)) {
			throw new Error(`Missing required traffic-source report column: ${name}`);
		}
	}

	return rows.map((row) => {
		const value = (name: (typeof required)[number]) => {
			const index = columns.get(name);
			if (index === undefined || index >= row.length) {
				throw new Error(`Missing ${name} value in traffic-source report row`);
			}
			return row[index];
		};
		const trafficSourceType = value("insightTrafficSourceType");
		if (typeof trafficSourceType !== "string" || !trafficSourceType.trim()) {
			throw new Error("Invalid insightTrafficSourceType value in report row");
		}
		return {
			traffic_source_type: trafficSourceType,
			views: parseMetric(value("views"), "views"),
			engaged_views: parseMetric(value("engagedViews"), "engagedViews"),
			watch_time_minutes: parseMetric(
				value("estimatedMinutesWatched"),
				"estimatedMinutesWatched",
			),
		};
	});
}
