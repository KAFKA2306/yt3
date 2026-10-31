import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
	parseReachReportCsv,
	type ReachReportMetadata,
} from "../src/domain/youtube_analytics_reach.js";
import {
	ensureReachAnalyticsTables,
	persistReachReport,
	purgeReachAnalyticsPastAuthorizationDeadline,
} from "../src/scripts/ingest_youtube_reporting_reach.js";

describe("YouTube Reporting API channel reach reports", () => {
	test("rejects incomplete, duplicate, malformed, and invalid metric rows", () => {
		expect(() => parseReachReportCsv("video_id,date\nv,2026-09-01\n")).toThrow(
			"Missing required channel reach column",
		);
		expect(() =>
			parseReachReportCsv(
				"video_id,date,channel_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr,video_thumbnail_impressions\n",
			),
		).toThrow("Duplicate channel reach column");
		expect(() =>
			parseReachReportCsv(
				"video_id,date,channel_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\nv,2026-09-01,c,1\n",
			),
		).toThrow("Malformed channel reach CSV row");
		expect(() =>
			parseReachReportCsv(
				"video_id,date,channel_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\nv,2026-02-30,c,-1,0\n",
			),
		).toThrow("Invalid channel reach report date");
		expect(() =>
			parseReachReportCsv(
				"video_id,date,channel_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\nv,2026-09-01,c,-1,0\n",
			),
		).toThrow("Invalid video_thumbnail_impressions");
		expect(() =>
			parseReachReportCsv(
				"video_id,date,channel_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\nv,2026-09-01,c,1,NaN\n",
			),
		).toThrow("Invalid video_thumbnail_impressions_ctr");
	});

	test("purges both report receipts and linked metrics at the storage deadline", () => {
		const db = new Database(":memory:");
		try {
			ensureReachAnalyticsTables(db);
			const report: ReachReportMetadata = {
				id: "report-old",
				jobId: "job-1",
				startTime: "2026-07-01T08:00:00Z",
				endTime: "2026-07-02T08:00:00Z",
				createTime: "2026-07-03T00:00:00Z",
				downloadUrl:
					"https://youtubereporting.googleapis.com/v1/media/report-old",
			};
			persistReachReport(db, {
				channelId: "channel-1",
				report,
				rows: [
					{
						video_id: "video-1",
						channel_id: "channel-1",
						report_date: "2026-07-01",
						thumbnail_impressions: 8,
						thumbnail_impressions_ctr: 0.25,
					},
				],
				episodes: [
					{
						episode_id: "byosan_money/2026-07-01-demo",
						video_id: "video-1",
						channel_id: "channel-1",
					},
				],
				sha256: "c".repeat(64),
				downloadedAt: "2026-07-04T00:00:00.000Z",
			});
			expect(
				purgeReachAnalyticsPastAuthorizationDeadline(
					db,
					new Date("2026-08-10T00:00:00Z"),
				),
			).toBe(2);
			expect(
				db
					.query("SELECT count(*) AS count FROM youtube_analytics_reach_daily")
					.get(),
			).toEqual({ count: 0 });
			expect(
				db
					.query(
						"SELECT count(*) AS count FROM youtube_analytics_reach_reports",
					)
					.get(),
			).toEqual({ count: 0 });
		} finally {
			db.close();
		}
	});
});
