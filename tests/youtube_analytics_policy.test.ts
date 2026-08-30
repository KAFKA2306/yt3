import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import fs from "fs-extra";
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
		expect(fs.existsSync(path.join(runDir, "analytics", "first_7d.json"))).toBe(
			false,
		);
		db.close();
	});
});
