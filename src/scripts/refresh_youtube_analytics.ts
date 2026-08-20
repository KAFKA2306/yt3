import { Database } from "bun:sqlite";
import path from "node:path";
import fs from "fs-extra";
import { discoverVideos } from "./ingest_youtube_analytics.js";

const DEFAULT_DB_FILE = "db/evolution.db";
const MAX_AUTHORIZATION_AGE_DAYS = 30;

export function purgeAnalyticsPastAuthorizationDeadline(
	db: Database,
	baseDir = process.cwd(),
	now = new Date(),
	maxAgeDays = MAX_AUTHORIZATION_AGE_DAYS,
): number {
	const cutoff = new Date(now.getTime() - maxAgeDays * 86_400_000)
		.toISOString()
		.replace("T", " ")
		.replace("Z", "");
	const stale = db
		.query(
			"SELECT video_id, age_window FROM youtube_analytics WHERE recorded_at < ?",
		)
		.all(cutoff) as Array<{ video_id: string; age_window: string }>;
	if (stale.length === 0) return 0;

	const runByVideoId = new Map(
		discoverVideos(baseDir).map((video) => [video.videoId, video.runDir]),
	);
	const remove = db.prepare(
		"DELETE FROM youtube_analytics WHERE video_id = ? AND age_window = ?",
	);
	for (const row of stale) {
		remove.run(row.video_id, row.age_window);
		const runDir = runByVideoId.get(row.video_id);
		if (runDir) {
			fs.removeSync(path.join(runDir, "analytics", `${row.age_window}.json`));
		}
	}
	return stale.length;
}

async function main() {
	const db = new Database(DEFAULT_DB_FILE);
	try {
		const purged = purgeAnalyticsPastAuthorizationDeadline(db);
		if (purged > 0) {
			console.log(
				`Purged ${purged} analytics record(s) older than ${MAX_AUTHORIZATION_AGE_DAYS} days before authorization refresh.`,
			);
		}
	} finally {
		db.close();
	}

	const child = Bun.spawn(["bun", "src/scripts/ingest_youtube_analytics.ts"], {
		cwd: process.cwd(),
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await child.exited;
	if (exitCode !== 0) {
		throw new Error(
			`YouTube Analytics refresh failed with exit code ${exitCode}`,
		);
	}
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
