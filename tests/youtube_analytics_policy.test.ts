import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import fs from "fs-extra";
import { ensureReachAnalyticsTables } from "../src/scripts/ingest_youtube_reporting_reach.js";
import { purgeAnalyticsPastAuthorizationDeadline } from "../src/scripts/refresh_youtube_analytics.js";

const tempRoots: string[] = [];

afterEach(() => {
	for (const root of tempRoots.splice(0)) fs.removeSync(root);
});

function createAnalyticsTable(db: Database) {
	db.exec(`
		CREATE TABLE youtube_analytics (
			video_id TEXT NOT NULL,
			channel_id TEXT NOT NULL,
			age_window TEXT NOT NULL,
			views INTEGER NOT NULL,
			recorded_at TEXT NOT NULL,
			PRIMARY KEY (video_id, age_window)
		)
	`);
	db.exec(`
		CREATE TABLE youtube_analytics_traffic_sources (
			episode_id TEXT NOT NULL,
			video_id TEXT NOT NULL,
			channel_id TEXT NOT NULL,
			age_window TEXT NOT NULL,
			traffic_source_type TEXT NOT NULL,
			views INTEGER,
			engaged_views INTEGER,
			watch_time_minutes REAL,
			recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (video_id, age_window, traffic_source_type)
		)
	`);
}

describe("YouTube Analytics 30-day storage boundary", () => {
	test("purges stale rows and matching raw evidence while retaining fresh rows", () => {
		const root = path.join(
			process.cwd(),
			"tests",
			`.tmp-analytics-policy-${Date.now()}`,
		);
		tempRoots.push(root);
		const runDir = path.join(root, "runs", "byosan_money", "dancer-test");
		fs.ensureDirSync(path.join(runDir, "publish"));
		fs.ensureDirSync(path.join(runDir, "analytics"));
		fs.writeJsonSync(path.join(runDir, "publish", "receipt.json"), {
			youtube: {
				video_id: "video-stale",
				channel_id: "channel-1",
				published_at: "2026-01-01T00:00:00Z",
			},
		});
		fs.writeJsonSync(path.join(runDir, "analytics", "first_7d.json"), {
			retrieved_at: "2026-06-01T00:00:00Z",
		});

		const db = new Database(":memory:");
		createAnalyticsTable(db);
		db.prepare("INSERT INTO youtube_analytics VALUES (?, ?, ?, ?, ?)").run(
			"video-stale",
			"channel-1",
			"first_7d",
			100,
			"2026-06-01 00:00:00",
		);
		db.prepare("INSERT INTO youtube_analytics VALUES (?, ?, ?, ?, ?)").run(
			"video-fresh",
			"channel-1",
			"first_7d",
			200,
			"2026-08-10 00:00:00",
		);
		db.prepare(
			`INSERT INTO youtube_analytics_traffic_sources
				(episode_id, video_id, channel_id, age_window, traffic_source_type, views)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		).run(
			"episode-stale",
			"video-stale",
			"channel-1",
			"first_7d",
			"YT_SEARCH",
			4,
		);
		db.prepare(
			`INSERT INTO youtube_analytics_traffic_sources
				(episode_id, video_id, channel_id, age_window, traffic_source_type, views)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		).run("episode-fresh", "video-fresh", "channel-1", "first_7d", "SHORTS", 9);

		const purged = purgeAnalyticsPastAuthorizationDeadline(
			db,
			root,
			new Date("2026-08-20T00:00:00Z"),
		);
		expect(purged).toBe(1);
		expect(
			db.query("SELECT count(*) AS n FROM youtube_analytics").get() as {
				n: number;
			},
		).toEqual({ n: 1 });
		expect(
			db
				.query(
					"SELECT video_id FROM youtube_analytics_traffic_sources ORDER BY video_id",
				)
				.all(),
		).toEqual([{ video_id: "video-fresh" }]);
		expect(fs.existsSync(path.join(runDir, "analytics", "first_7d.json"))).toBe(
			false,
		);
		db.close();
	});

	test("the regular refresh also purges expired channel-reach reports", () => {
		const db = new Database(":memory:");
		createAnalyticsTable(db);
		ensureReachAnalyticsTables(db);
		db.prepare(`
			INSERT INTO youtube_analytics_reach_daily (
				episode_id, video_id, channel_id, report_date,
				thumbnail_impressions, thumbnail_impressions_ctr, report_id,
				report_created_at, downloaded_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			"byosan_money/2026-07-01-demo",
			"video-old",
			"channel-1",
			"2026-07-01",
			12,
			0.2,
			"report-old",
			"2026-07-02T00:00:00.000Z",
			"2026-07-03T00:00:00.000Z",
		);
		db.prepare(`
			INSERT INTO youtube_analytics_reach_reports (
				report_id, job_id, channel_id, report_date, report_created_at,
				source_row_count, linked_row_count, unlinked_row_count, sha256, downloaded_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			"report-old",
			"job-1",
			"channel-1",
			"2026-07-01",
			"2026-07-02T00:00:00.000Z",
			1,
			1,
			0,
			"0".repeat(64),
			"2026-07-03T00:00:00.000Z",
		);
		try {
			expect(
				purgeAnalyticsPastAuthorizationDeadline(
					db,
					process.cwd(),
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
