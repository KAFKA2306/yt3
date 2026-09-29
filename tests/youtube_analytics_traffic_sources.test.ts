import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
	buildTrafficSourceQuery,
	parseTrafficSourceRows,
} from "../src/domain/youtube_analytics_traffic_sources.js";
import { saveTrafficSourceSnapshot } from "../src/scripts/ingest_youtube_analytics.js";

describe("YouTube Analytics traffic-source report", () => {
	test("builds the supported per-video traffic-source query", () => {
		expect(
			buildTrafficSourceQuery({
				channelId: "channel-1",
				videoId: "video-1",
				startDate: "2026-08-01",
				endDate: "2026-08-07",
			}),
		).toEqual({
			ids: "channel==channel-1",
			startDate: "2026-08-01",
			endDate: "2026-08-07",
			metrics: "views,engagedViews,estimatedMinutesWatched",
			dimensions: "insightTrafficSourceType",
			filters: "video==video-1",
		});
	});

	test("parses rows by header name and preserves zero-valued metrics", () => {
		const records = parseTrafficSourceRows(
			[
				{ name: "views" },
				{ name: "insightTrafficSourceType" },
				{ name: "estimatedMinutesWatched" },
				{ name: "engagedViews" },
			],
			[
				[8, "YT_SEARCH", 2.5, 7],
				[0, "SHORTS", 0, 0],
				[null, "UNKNOWN", null, null],
			],
		);

		expect(records).toEqual([
			{
				traffic_source_type: "YT_SEARCH",
				views: 8,
				engaged_views: 7,
				watch_time_minutes: 2.5,
			},
			{
				traffic_source_type: "SHORTS",
				views: 0,
				engaged_views: 0,
				watch_time_minutes: 0,
			},
			{
				traffic_source_type: "UNKNOWN",
				views: null,
				engaged_views: null,
				watch_time_minutes: null,
			},
		]);
	});

	test("returns no rows for a successful empty report", () => {
		expect(parseTrafficSourceRows([], undefined)).toEqual([]);
	});

	test("rejects a non-empty response without required metric headers", () => {
		expect(() =>
			parseTrafficSourceRows(
				[{ name: "insightTrafficSourceType" }],
				[["YT_SEARCH"]],
			),
		).toThrow("Missing required traffic-source report column");
	});

	test("persists source rows under the episode and replaces a window atomically", () => {
		const db = new Database(":memory:");
		try {
			const snapshot = {
				episode_id: "byosan_money/2026-08-01-demo",
				video_id: "video-1",
				channel_id: "channel-1",
				age_window: "first_7d" as const,
				rows: [
					{
						traffic_source_type: "YT_SEARCH",
						views: 8,
						engaged_views: 7,
						watch_time_minutes: 2.5,
					},
				],
			};
			saveTrafficSourceSnapshot(db, snapshot);

			expect(
				db
					.query(
						"SELECT episode_id, traffic_source_type, views, engaged_views, watch_time_minutes FROM youtube_analytics_traffic_sources",
					)
					.all(),
			).toEqual([
				{
					episode_id: "byosan_money/2026-08-01-demo",
					traffic_source_type: "YT_SEARCH",
					views: 8,
					engaged_views: 7,
					watch_time_minutes: 2.5,
				},
			]);

			saveTrafficSourceSnapshot(db, {
				...snapshot,
				rows: [
					{
						traffic_source_type: "SHORTS",
						views: 12,
						engaged_views: 11,
						watch_time_minutes: 4.25,
					},
				],
			});
			expect(
				db
					.query(
						"SELECT traffic_source_type FROM youtube_analytics_traffic_sources",
					)
					.all(),
			).toEqual([{ traffic_source_type: "SHORTS" }]);

			saveTrafficSourceSnapshot(db, { ...snapshot, rows: [] });
			expect(
				db
					.query(
						"SELECT count(*) AS count FROM youtube_analytics_traffic_sources",
					)
					.get(),
			).toEqual({ count: 0 });
		} finally {
			db.close();
		}
	});
});
