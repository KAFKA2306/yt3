import { describe, expect, test } from "bun:test";
import {
	deriveAudienceWatchRatioAtThreeSeconds,
	parseAudienceRetentionRows,
	parseYouTubeDurationSeconds,
} from "../src/domain/youtube_analytics_retention.js";

describe("YouTube first-three-second audience-watch metric", () => {
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
