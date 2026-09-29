import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
	buildAudienceRetentionQuery,
	deriveAudienceWatchRatioAtThreeSeconds,
	parseAudienceRetentionRows,
	parseYouTubeDurationSeconds,
} from "../src/domain/youtube_analytics_retention.js";
import { saveAnalyticsRecord } from "../src/scripts/ingest_youtube_analytics.js";

describe("YouTube first-three-second audience-watch metric", () => {
	test("builds one read-only retention query for exactly one video", () => {
		expect(
			buildAudienceRetentionQuery({
				channelId: "channel-1",
				videoId: "video-1",
				startDate: "2026-09-01",
				endDate: "2026-09-07",
			}),
		).toEqual({
			ids: "channel==channel-1",
			startDate: "2026-09-01",
			endDate: "2026-09-07",
			metrics: "audienceWatchRatio",
			dimensions: "elapsedVideoTimeRatio",
			filters: "video==video-1",
		});
	});

	test("persists the derived value and its formula evidence in the analytics row", () => {
		const db = new Database(":memory:");
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
				subscribers_gained INTEGER,
				subscribers_lost INTEGER,
				recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
				PRIMARY KEY (video_id, age_window)
			)
		`);
		const evidence = deriveAudienceWatchRatioAtThreeSeconds(60, [
			{ elapsed_video_time_ratio: 0.02, audience_watch_ratio: 1.2 },
			{ elapsed_video_time_ratio: 0.08, audience_watch_ratio: 0.8 },
		]);
		if (evidence.status !== "DERIVED")
			throw new Error("expected a derived value");

		saveAnalyticsRecord(db, {
			video_id: "video-1",
			channel_id: "channel-1",
			age_window: "first_7d",
			views: 12,
			engaged_views: 10,
			watch_time_minutes: 3,
			average_view_duration_seconds: 15,
			average_view_percentage: 25,
			likes: 2,
			comments: 0,
			shares: 1,
			subscribers_gained: 1,
			subscribers_lost: 0,
			first_3s_audience_watch_ratio: evidence.value,
			first_3s_audience_watch_ratio_evidence: evidence,
		});

		const row = db
			.query(
				"SELECT first_3s_audience_watch_ratio, first_3s_audience_watch_ratio_evidence_json FROM youtube_analytics WHERE video_id = ?",
			)
			.get("video-1") as {
			first_3s_audience_watch_ratio: number;
			first_3s_audience_watch_ratio_evidence_json: string;
		};
		expect(row.first_3s_audience_watch_ratio).toBe(evidence.value);
		expect(JSON.parse(row.first_3s_audience_watch_ratio_evidence_json)).toEqual(
			evidence,
		);
		db.close();
	});

	test("uses an exact sample without clamping replay ratios", () => {
		const result = deriveAudienceWatchRatioAtThreeSeconds(60, [
			{ elapsed_video_time_ratio: 0.01, audience_watch_ratio: 1.2 },
			{ elapsed_video_time_ratio: 0.05, audience_watch_ratio: 1.04 },
			{ elapsed_video_time_ratio: 0.09, audience_watch_ratio: 0.8 },
		]);

		expect(result).toMatchObject({
			status: "DERIVED",
			value: 1.04,
			source_metric: "audienceWatchRatio",
			source_dimension: "elapsedVideoTimeRatio",
			formula_version: "youtube-audience-watch-ratio-at-3s-linear-v1",
			target_elapsed_seconds: 3,
			target_elapsed_video_time_ratio: 0.05,
			video_duration_seconds: 60,
			sample_count: 3,
			sampling_resolution_seconds: 2.4,
			method: "exact_sample",
		});
	});

	test("sorts samples and linearly interpolates the three-second position", () => {
		const result = deriveAudienceWatchRatioAtThreeSeconds(60, [
			{ elapsed_video_time_ratio: 0.08, audience_watch_ratio: 0.8 },
			{ elapsed_video_time_ratio: 0.02, audience_watch_ratio: 1.2 },
		]);

		expect(result).toMatchObject({
			status: "DERIVED",
			value: 1,
			method: "linear_interpolation",
			target_elapsed_video_time_ratio: 0.05,
			sampling_resolution_seconds: 3.6,
			interpolation_interval: {
				lower_elapsed_video_time_ratio: 0.02,
				upper_elapsed_video_time_ratio: 0.08,
			},
		});
	});

	test("does not extrapolate when the reported curve does not cover three seconds", () => {
		const result = deriveAudienceWatchRatioAtThreeSeconds(600, [
			{ elapsed_video_time_ratio: 0.01, audience_watch_ratio: 0.9 },
			{ elapsed_video_time_ratio: 0.02, audience_watch_ratio: 0.8 },
		]);

		expect(result).toMatchObject({
			status: "UNAVAILABLE",
			value: null,
			reason: "target_before_first_sample",
			target_elapsed_video_time_ratio: 0.005,
		});
	});

	test("reports unavailable when the video is shorter than three seconds or the curve is empty", () => {
		expect(deriveAudienceWatchRatioAtThreeSeconds(2.5, [])).toMatchObject({
			status: "UNAVAILABLE",
			value: null,
			reason: "target_exceeds_video_duration",
		});
		expect(deriveAudienceWatchRatioAtThreeSeconds(30, [])).toMatchObject({
			status: "UNAVAILABLE",
			value: null,
			reason: "retention_curve_empty",
		});
	});

	test("records missing duration rather than inventing a three-second value", () => {
		expect(
			deriveAudienceWatchRatioAtThreeSeconds(null, [
				{ elapsed_video_time_ratio: 0.5, audience_watch_ratio: 0.7 },
			]),
		).toMatchObject({
			status: "UNAVAILABLE",
			value: null,
			reason: "video_duration_unavailable",
			target_elapsed_video_time_ratio: null,
		});
	});

	test("maps API columns by name and parses numeric strings", () => {
		expect(
			parseAudienceRetentionRows(
				[
					{
						name: "audienceWatchRatio",
						dataType: "FLOAT",
						columnType: "METRIC",
					},
					{
						name: "elapsedVideoTimeRatio",
						dataType: "FLOAT",
						columnType: "DIMENSION",
					},
				],
				[["1.25", "0.05"]],
			),
		).toEqual([{ elapsed_video_time_ratio: 0.05, audience_watch_ratio: 1.25 }]);
	});

	test("rejects malformed, duplicate, or out-of-range curve samples", () => {
		expect(() =>
			parseAudienceRetentionRows(
				[{ name: "elapsedVideoTimeRatio" }, { name: "audienceWatchRatio" }],
				[["0.05", "NaN"]],
			),
		).toThrow(/finite non-negative/);
		expect(() =>
			parseAudienceRetentionRows(
				[{ name: "elapsedVideoTimeRatio" }, { name: "audienceWatchRatio" }],
				[["0.05", null]],
			),
		).toThrow(/finite non-negative/);
		expect(() =>
			deriveAudienceWatchRatioAtThreeSeconds(60, [
				{ elapsed_video_time_ratio: 0.05, audience_watch_ratio: 1 },
				{ elapsed_video_time_ratio: 0.05, audience_watch_ratio: 0.9 },
			]),
		).toThrow(/duplicate elapsedVideoTimeRatio/);
	});

	test("parses YouTube's ISO 8601 duration and rejects malformed durations", () => {
		expect(parseYouTubeDurationSeconds("PT15M33S")).toBe(933);
		expect(parseYouTubeDurationSeconds("P1DT2H3M4.5S")).toBe(93_784.5);
		expect(parseYouTubeDurationSeconds("PT0S")).toBeNull();
		expect(() => parseYouTubeDurationSeconds("not-a-duration")).toThrow(
			/invalid YouTube video duration/,
		);
	});
});
