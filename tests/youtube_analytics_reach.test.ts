import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
	type ReachReportMetadata,
	getReachReportDate,
	parseReachReportCsv,
	selectLatestReachReports,
} from "../src/domain/youtube_analytics_reach.js";
import {
	ensureReachAnalyticsTables,
	persistReachReport,
	purgeReachAnalyticsPastAuthorizationDeadline,
} from "../src/scripts/ingest_youtube_reporting_reach.js";

describe("YouTube Reporting API channel reach reports", () => {
	test("parses CSV by header, including quoted fields, BOM, and CRLF", () => {
		expect(
			parseReachReportCsv(
				"\uFEFFvideo_id,date,channel_id,video_thumbnail_impressions_ctr,video_thumbnail_impressions\r\n" +
					"video-1,2026-09-01,channel-1,0.125,800\r\n" +
					'"video,2",2026-09-01,channel-1,0,0\r\n',
			),
		).toEqual([
			{
				video_id: "video-1",
				channel_id: "channel-1",
				report_date: "2026-09-01",
				thumbnail_impressions: 800,
				thumbnail_impressions_ctr: 0.125,
			},
			{
				video_id: "video,2",
				channel_id: "channel-1",
				report_date: "2026-09-01",
				thumbnail_impressions: 0,
				thumbnail_impressions_ctr: 0,
			},
		]);
	});

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

	test("selects only the newest unambiguous report revision per report day", () => {
		const reports: ReachReportMetadata[] = [
			{
				id: "old",
				jobId: "job-1",
				startTime: "2026-09-01T08:00:00Z",
				endTime: "2026-09-02T08:00:00Z",
				createTime: "2026-09-03T00:00:00Z",
				downloadUrl: "https://youtubereporting.googleapis.com/v1/media/old",
			},
			{
				id: "new",
				jobId: "job-1",
				startTime: "2026-09-01T08:00:00Z",
				endTime: "2026-09-02T08:00:00Z",
				createTime: "2026-09-04T00:00:00Z",
				downloadUrl: "https://youtubereporting.googleapis.com/v1/media/new",
			},
			{
				id: "next-day",
				jobId: "job-1",
				startTime: "2026-09-02T08:00:00Z",
				endTime: "2026-09-03T08:00:00Z",
				createTime: "2026-09-04T00:00:00Z",
				downloadUrl:
					"https://youtubereporting.googleapis.com/v1/media/next-day",
			},
		];
		const oldReport = reports.find((report) => report.id === "old");
		if (!oldReport) throw new Error("Missing channel reach report fixture");

		expect(selectLatestReachReports(reports, new Set(["next-day"]))).toEqual([
			reports[1],
		]);
		expect(() =>
			selectLatestReachReports(
				[oldReport, { ...oldReport, id: "same-time" }],
				new Set(),
			),
		).toThrow("Ambiguous channel reach report revisions");
		expect(() =>
			getReachReportDate({
				...oldReport,
				downloadUrl: "https://example.com/v1/media/report",
			}),
		).toThrow("Unexpected channel reach report download URL");
		expect(() =>
			getReachReportDate({
				...oldReport,
				endTime: "2026-09-03T08:00:00Z",
			}),
		).toThrow("Channel reach report must cover one fixed-PST day");
		expect(() =>
			getReachReportDate({
				...oldReport,
				startTime: "2026-09-01T00:00:00Z",
				endTime: "2026-09-02T00:00:00Z",
			}),
		).toThrow("Channel reach report must cover one fixed-PST day");
	});

	test("links only known episodes and replaces a day atomically on report revision", () => {
		const db = new Database(":memory:");
		try {
			ensureReachAnalyticsTables(db);
			const report: ReachReportMetadata = {
				id: "report-1",
				jobId: "job-1",
				startTime: "2026-09-01T08:00:00Z",
				endTime: "2026-09-02T08:00:00Z",
				createTime: "2026-09-03T00:00:00Z",
				downloadUrl:
					"https://youtubereporting.googleapis.com/v1/media/report-1",
			};
			const rows = parseReachReportCsv(
				"video_id,channel_id,date,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n" +
					"video-1,channel-1,2026-09-01,800,0.125\n" +
					"untracked-video,channel-1,2026-09-01,20,0.05\n",
			);
			expect(getReachReportDate(report)).toBe("2026-09-01");
			expect(
				persistReachReport(db, {
					channelId: "channel-1",
					report,
					rows,
					episodes: [
						{
							episode_id: "byosan_money/2026-09-01-demo",
							video_id: "video-1",
							channel_id: "channel-1",
						},
					],
					sha256: "a".repeat(64),
					downloadedAt: "2026-09-04T00:00:00.000Z",
				}),
			).toEqual({ sourceRowCount: 2, linkedRowCount: 1, unlinkedRowCount: 1 });
			expect(
				db
					.query(
						"SELECT episode_id, video_id, report_date, thumbnail_impressions, thumbnail_impressions_ctr, report_id FROM youtube_analytics_reach_daily",
					)
					.all(),
			).toEqual([
				{
					episode_id: "byosan_money/2026-09-01-demo",
					video_id: "video-1",
					report_date: "2026-09-01",
					thumbnail_impressions: 800,
					thumbnail_impressions_ctr: 0.125,
					report_id: "report-1",
				},
			]);

			const revised = {
				...report,
				id: "report-2",
				createTime: "2026-09-05T00:00:00Z",
			};
			persistReachReport(db, {
				channelId: "channel-1",
				report: revised,
				rows: [],
				episodes: [],
				sha256: "b".repeat(64),
				downloadedAt: "2026-09-05T00:00:00.000Z",
			});
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
			).toEqual({ count: 2 });
		} finally {
			db.close();
		}
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
