import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import fs from "fs-extra";
import {
	findRunDirsForDate,
	getMissingEvidence,
	isEvidenceReady,
} from "../src/io/utils/stability.ts";

const originalCwd = process.cwd;
const TEMP_DIR = path.join(__dirname, "temp_stability_test_cwd");

type AnalyticsRow = {
	views: number;
	engaged_views: number;
	likes: number;
	subscribers_gained: number;
	subscribers_lost: number;
	subscribers_net: number | null;
	satisfaction_score: number | null;
};

afterAll(async () => {
	await fs.remove(TEMP_DIR);
});

describe("Stability and Audit Helpers", () => {
	beforeAll(async () => {
		await fs.ensureDir(TEMP_DIR);
		Object.defineProperty(process, "cwd", {
			value: () => TEMP_DIR,
			configurable: true,
		});
	});

	afterAll(async () => {
		Object.defineProperty(process, "cwd", {
			value: originalCwd,
			configurable: true,
		});
		await fs.remove(TEMP_DIR);
	});

	test("findRunDirsForDate matches exact date and suffixed dates", async () => {
		const bucketDir = path.join(TEMP_DIR, "runs", "byosan_money");
		await fs.ensureDir(bucketDir);

		await fs.ensureDir(path.join(bucketDir, "2026-07-05"));
		await fs.ensureDir(path.join(bucketDir, "2026-07-05-june-swoon-femo"));
		await fs.ensureDir(path.join(bucketDir, "2026-07-06"));

		const dirs = findRunDirsForDate("byosan_money", "2026-07-05");
		const basenames = dirs.map((d) => path.basename(d));

		expect(basenames).toContain("2026-07-05");
		expect(basenames).toContain("2026-07-05-june-swoon-femo");
		expect(basenames).not.toContain("2026-07-06");
	});

	test("isEvidenceReady requires the canonical proof chain", async () => {
		const runDir = path.join(
			TEMP_DIR,
			"runs",
			"byosan_money",
			"2026-07-10-test",
		);
		await fs.ensureDir(runDir);

		expect(isEvidenceReady(runDir)).toBe(false);
		expect(getMissingEvidence(runDir)).toContain("run_evidence.json");

		const evidencePath = path.join(runDir, "run_evidence.json");
		await fs.writeFile(evidencePath, "invalid json");
		expect(isEvidenceReady(runDir)).toBe(false);
		expect(getMissingEvidence(runDir)[0]).toContain(
			"run_evidence.json (invalid JSON)",
		);

		const failedEvidence = {
			run_id: "byosan_money/2026-07-10-test",
			bucket: "byosan_money",
			status: "failed",
			disposition: "fatal",
			public_url: "https://www.youtube.com/watch?v=123",
		};
		await fs.writeJson(evidencePath, failedEvidence, { spaces: 2 });
		expect(isEvidenceReady(runDir)).toBe(false);
		let missing = getMissingEvidence(runDir);
		expect(missing).toContain("evidence disposition=fatal");

		const successEvidence = {
			run_id: "byosan_money/2026-07-10-test",
			bucket: "byosan_money",
			status: "success",
			disposition: "success",
			public_url: "https://www.youtube.com/watch?v=123",
		};
		await fs.writeJson(evidencePath, successEvidence, { spaces: 2 });
		expect(isEvidenceReady(runDir)).toBe(false);
		missing = getMissingEvidence(runDir);
		expect(missing).toContain("publish/receipt.json");
		expect(missing).toContain("publish/state.json");
		expect(missing).toContain("media/video/video.mp4");
		expect(missing).toContain("research.json");
		expect(missing).toContain("audit/report.json");

		await fs.writeJson(path.join(runDir, "research.json"), {});
		await fs.ensureDir(path.join(runDir, "media", "video"));
		await fs.writeFile(path.join(runDir, "media", "video", "video.mp4"), "");
		await fs.ensureDir(path.join(runDir, "publish"));
		await fs.writeJson(path.join(runDir, "publish", "receipt.json"), {
			youtube: { video_id: "123" },
		});
		await fs.writeJson(path.join(runDir, "publish", "state.json"), {
			phase: "VERIFIED",
			video_id: "123",
		});
		await fs.ensureDir(path.join(runDir, "audit"));
		await fs.writeJson(path.join(runDir, "audit", "report.json"), {
			decision: "PASS",
		});

		expect(isEvidenceReady(runDir)).toBe(true);
		expect(getMissingEvidence(runDir).length).toBe(0);
	});
});

describe("YouTube Analytics Seam", () => {
	test("discoverVideos finds receipts in mock run directories", async () => {
		const {
			discoverVideos,
		} = require("../src/scripts/ingest_youtube_analytics.ts");
		const runDir = path.join(
			TEMP_DIR,
			"runs",
			"byosan_money",
			"2026-07-11-test",
		);
		await fs.ensureDir(path.join(runDir, "publish"));
		await fs.writeJson(path.join(runDir, "publish", "receipt.json"), {
			youtube: {
				video_id: "XYZ789",
				published_at: "2026-07-11T12:00:00Z",
				channel_id: "UCYtjO-PYBfdG3MuPLXfhA-Q",
			},
		});
		const videos = discoverVideos(TEMP_DIR);
		const match = videos.find((v) => v.videoId === "XYZ789");
		expect(match).toBeDefined();
		expect(match?.channelId).toBe("UCYtjO-PYBfdG3MuPLXfhA-Q");
	});

	test("saveAnalyticsRecord persists only raw official metrics", async () => {
		const {
			saveAnalyticsRecord,
		} = require("../src/scripts/ingest_youtube_analytics.ts");
		const { Database } = require("bun:sqlite");
		const testDbPath = path.join(TEMP_DIR, "test_evolution.db");

		const db = new Database(testDbPath);
		db.exec(`
			CREATE TABLE IF NOT EXISTS youtube_analytics (
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
			video_id: "XYZ789",
			channel_id: "UCYtjO-PYBfdG3MuPLXfhA-Q",
			age_window: "published_day" as const,
			views: 150,
			engaged_views: 140,
			watch_time_minutes: 4.5,
			average_view_duration_seconds: 1.8,
			average_view_percentage: 45.0,
			likes: 12,
			comments: 3,
			shares: 1,
			subscribers_gained: 5,
			subscribers_lost: 1,
		};

		saveAnalyticsRecord(db, record);

		const row = db
			.query("SELECT * FROM youtube_analytics WHERE video_id = 'XYZ789'")
			.get() as AnalyticsRow;
		expect(row).toBeDefined();
		expect(row.views).toBe(150);
		expect(row.engaged_views).toBe(140);
		expect(row.likes).toBe(12);
		expect(row.subscribers_gained).toBe(5);
		expect(row.subscribers_lost).toBe(1);
		expect(row.subscribers_net).toBeNull();
		expect(row.satisfaction_score).toBeNull();

		record.views = 200;
		record.likes = 15;
		saveAnalyticsRecord(db, record);

		const updatedRow = db
			.query("SELECT * FROM youtube_analytics WHERE video_id = 'XYZ789'")
			.get() as AnalyticsRow;
		expect(updatedRow.views).toBe(200);
		expect(updatedRow.likes).toBe(15);
		expect(updatedRow.satisfaction_score).toBeNull();

		db.close();
	});
});

describe("Audio Quality Assurance", () => {
	test("runAudioQA handles non-existent file path gracefully", () => {
		const { runAudioQA } = require("../src/io/utils/audio_qa.ts");
		const result = runAudioQA("non_existent_video.mp4", TEMP_DIR);
		expect(result.status).toBe("INFRA_FAIL");
		expect(result.details).toContain("Video file not found");
		expect(result.report.final_decision).toBe("FAIL");
	});
});
