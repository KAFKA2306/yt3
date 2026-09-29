import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
	buildCardMetricsQuery,
	parseCardMetricsRow,
} from "../src/domain/youtube_analytics_cards.js";
import { saveAnalyticsRecord } from "../src/scripts/ingest_youtube_analytics.js";

describe("YouTube Analytics card metrics", () => {
	test("builds the dimensionless, per-video user-activity query", () => {
		expect(
			buildCardMetricsQuery({
				channelId: "channel-1",
				videoId: "video-1",
				startDate: "2026-08-01",
				endDate: "2026-08-07",
			}),
		).toEqual({
			ids: "channel==channel-1",
			startDate: "2026-08-01",
			endDate: "2026-08-07",
			metrics:
				"cardImpressions,cardClicks,cardClickRate,cardTeaserImpressions,cardTeaserClicks,cardTeaserClickRate",
			filters: "video==video-1",
		});
	});

	test("parses metric values by header and keeps zero distinct from unavailable", () => {
		expect(
			parseCardMetricsRow(
				[
					{ name: "cardTeaserClickRate" },
					{ name: "cardClicks" },
					{ name: "cardImpressions" },
					{ name: "cardClickRate" },
					{ name: "cardTeaserClicks" },
					{ name: "cardTeaserImpressions" },
				],
				[[null, 0, 0, 0, 0, 12]],
			),
		).toEqual({
			card_impressions: 0,
			card_clicks: 0,
			card_click_rate: 0,
			card_teaser_impressions: 12,
			card_teaser_clicks: 0,
			card_teaser_click_rate: null,
		});
	});

	test("represents a successful report with no rows as unavailable metrics", () => {
		expect(parseCardMetricsRow([], undefined)).toEqual({
			card_impressions: null,
			card_clicks: null,
			card_click_rate: null,
			card_teaser_impressions: null,
			card_teaser_clicks: null,
			card_teaser_click_rate: null,
		});
	});

	test("rejects malformed non-empty rows instead of silently shifting values", () => {
		expect(() =>
			parseCardMetricsRow([{ name: "cardImpressions" }], [[1]]),
		).toThrow("Missing required card-metrics report column");
		expect(() =>
			parseCardMetricsRow(
				[
					{ name: "cardImpressions" },
					{ name: "cardClicks" },
					{ name: "cardClickRate" },
					{ name: "cardTeaserImpressions" },
					{ name: "cardTeaserClicks" },
					{ name: "cardTeaserClickRate" },
				],
				[[1, 0, 0, 0, 0, Number.NaN]],
			),
		).toThrow("Invalid cardTeaserClickRate value");
	});

	test("persists official card metrics and clears them when a later result is unavailable", () => {
		const db = new Database(":memory:");
		try {
			db.exec(`
				CREATE TABLE youtube_analytics (
					video_id TEXT NOT NULL,
					channel_id TEXT NOT NULL,
					age_window TEXT NOT NULL,
					views INTEGER NOT NULL,
					watch_time_minutes REAL,
					average_view_duration_seconds REAL,
					average_view_percentage REAL,
					likes INTEGER,
					comments INTEGER,
					shares INTEGER,
					subscribers_net INTEGER,
					satisfaction_score REAL,
					recorded_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
					PRIMARY KEY (video_id, age_window)
				)
			`);
			const record = {
				episode_id: "byosan_money/2026-08-01-demo",
				video_id: "video-1",
				channel_id: "channel-1",
				age_window: "published_day" as const,
				views: 10,
				engaged_views: 8,
				watch_time_minutes: 2,
				average_view_duration_seconds: 12,
				average_view_percentage: 50,
				likes: 1,
				comments: 0,
				shares: 0,
				subscribers_gained: 0,
				subscribers_lost: 0,
				card_impressions: 20,
				card_clicks: 3,
				card_click_rate: 0.15,
				card_teaser_impressions: 40,
				card_teaser_clicks: 8,
				card_teaser_click_rate: 0.2,
			};

			saveAnalyticsRecord(db, record);
			expect(
				db
					.query(
						"SELECT card_impressions, card_clicks, card_click_rate, card_teaser_impressions, card_teaser_clicks, card_teaser_click_rate FROM youtube_analytics WHERE video_id = ?",
					)
					.get("video-1"),
			).toEqual({
				card_impressions: 20,
				card_clicks: 3,
				card_click_rate: 0.15,
				card_teaser_impressions: 40,
				card_teaser_clicks: 8,
				card_teaser_click_rate: 0.2,
			});

			saveAnalyticsRecord(db, {
				...record,
				card_impressions: null,
				card_clicks: null,
				card_click_rate: null,
				card_teaser_impressions: null,
				card_teaser_clicks: null,
				card_teaser_click_rate: null,
			});
			expect(
				db
					.query(
						"SELECT card_impressions, card_teaser_click_rate FROM youtube_analytics WHERE video_id = ?",
					)
					.get("video-1"),
			).toEqual({ card_impressions: null, card_teaser_click_rate: null });
		} finally {
			db.close();
		}
	});
});
