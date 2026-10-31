import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { writeByosanPerformanceSummary } from "../src/domain/byosan/performance.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.removeSync(root);
});

describe("byosan performance summary", () => {
	test("excludes missing metrics from averages and sample thresholds", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "byosan-performance-"));
		roots.push(root);
		const dbPath = path.join(root, "analytics.db");
		const db = new Database(dbPath);
		db.exec(
			"CREATE TABLE youtube_analytics (video_id TEXT, age_window TEXT, views REAL, watch_time_minutes REAL, average_view_percentage REAL, subscribers_gained REAL)",
		);
		db.exec(
			"CREATE TABLE youtube_analytics_reach_daily (video_id TEXT, report_date TEXT, thumbnail_impressions INTEGER, thumbnail_impressions_ctr REAL)",
		);
		const insert = db.prepare(
			"INSERT INTO youtube_analytics VALUES (?, 'first_7d', 10, ?, ?, ?)",
		);
		const insertReach = db.prepare(
			"INSERT INTO youtube_analytics_reach_daily VALUES (?, ?, ?, ?)",
		);
		const spec = fs.readJsonSync(
			"config/productions/sp500_anthropic_2026q2.json",
		);
		for (const [index, retention] of [40, null, 0].entries()) {
			const dir = path.join(root, "runs/byosan_money", `run-${index}`);
			fs.outputJsonSync(path.join(dir, "publish/receipt.json"), {
				youtube: {
					video_id: `id-${index}`,
					published_at: "2026-10-01T12:00:00Z",
				},
			});
			fs.outputJsonSync(path.join(dir, "source/feature_spec.json"), spec);
			fs.outputJsonSync(path.join(dir, "state.json"), {
				script: { total_duration: 200 },
			});
			insert.run(`id-${index}`, null, retention, null);
		}
		insertReach.run("id-0", "2026-10-01", 1000, 0.06);
		insertReach.run("id-2", "2026-10-07", 3000, 0);
		db.close();
		const summary = writeByosanPerformanceSummary(dbPath, root, 3);
		expect(summary.status).toBe("INSUFFICIENT_DATA");
		expect(summary.preferredFormat).toBeUndefined();
		expect(summary.observations).toMatchObject([
			{ runId: "run-0", videoId: "id-0", thumbnailImpressionsCtr: 0.06 },
			{ runId: "run-1", videoId: "id-1", thumbnailImpressionsCtr: null },
			{ runId: "run-2", videoId: "id-2", thumbnailImpressionsCtr: 0 },
		]);
		expect(summary.groups[0]).toMatchObject({
			sampleCount: 3,
			averageViewPercentage: 20,
			thumbnailImpressionsCtr: 0.03,
			watchTimeMinutesAverage: null,
			subscribersGainedAverage: null,
			metricSampleCounts: {
				averageViewPercentage: 2,
				thumbnailImpressionsCtr: 2,
				watchTimeMinutes: 0,
				subscribersGained: 0,
			},
		});
	});
});
