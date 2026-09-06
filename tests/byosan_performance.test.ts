import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { buildByosanPerformanceSummary } from "../src/domain/byosan/performance.js";

const tempRoots: string[] = [];

function makeRoot(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "yt3-performance-"));
	tempRoots.push(root);
	return root;
}

afterEach(() => {
	while (tempRoots.length > 0) {
		const root = tempRoots.pop();
		if (root) fs.removeSync(root);
	}
});

describe("byosan analytics feedback", () => {
	test("first_7d metrics create a soft preferred format only after enough samples", async () => {
		const root = makeRoot();
		const db = new Database(":memory:");
		db.exec(`
			CREATE TABLE youtube_analytics (
				video_id TEXT NOT NULL,
				channel_id TEXT NOT NULL,
				age_window TEXT NOT NULL,
				views INTEGER NOT NULL,
				watch_time_minutes REAL,
				average_view_percentage REAL,
				subscribers_gained INTEGER,
				PRIMARY KEY (video_id, age_window)
			);
		`);
		const base = await fs.readJson(
			path.join(process.cwd(), "config/productions/sp500_anthropic_2026q2.json"),
		);
		for (let index = 0; index < 3; index++) {
			const runName = `2026-08-0${index + 1}-daily`;
			const runDir = path.join(root, "runs", "byosan_money", runName);
			fs.ensureDirSync(path.join(runDir, "source"));
			fs.ensureDirSync(path.join(runDir, "publish"));
			fs.writeJsonSync(
				path.join(runDir, "source", "feature_spec.json"),
				{
					...base,
					runId: `byosan_money/${runName}`,
					asOf: `2026-08-0${index + 1}`,
					production: {
						format: "comparison",
						targetMinutes: 8,
						minSegments: 20,
						maxSegments: 32,
						reasons: ["test"],
					},
				},
			);
			fs.writeJsonSync(path.join(runDir, "state.json"), {
				run_id: `byosan_money/${runName}`,
				bucket: "byosan_money",
				script: {
					title: "test",
					description: "test",
					lines: [],
					total_duration: 480,
				},
			});
			fs.writeJsonSync(path.join(runDir, "publish", "receipt.json"), {
				youtube: { video_id: `video-${index}` },
			});
			db.query(
				`INSERT INTO youtube_analytics (
					video_id, channel_id, age_window, views,
					watch_time_minutes, average_view_percentage, subscribers_gained
				) VALUES (?, ?, 'first_7d', ?, ?, ?, ?)`,
			).run(
				`video-${index}`,
				"channel",
				1000 + index * 100,
				500 + index * 10,
				60 + index,
				10 + index,
			);
		}

		const insufficient = buildByosanPerformanceSummary(db, root, 4);
		expect(insufficient.status).toBe("INSUFFICIENT_DATA");
		expect(insufficient.preferredFormat).toBeUndefined();

		const ready = buildByosanPerformanceSummary(db, root, 3);
		expect(ready.status).toBe("READY");
		expect(ready.preferredFormat).toBe("comparison");
		expect(ready.sampleCount).toBe(3);
		expect(ready.groups[0]?.averageViewPercentage).toBe(61);
		db.close();
	});
});
