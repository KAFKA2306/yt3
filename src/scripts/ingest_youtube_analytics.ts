import { Database } from "bun:sqlite";
import path from "node:path";
import fs from "fs-extra";
import { google } from "googleapis";
import {
	createYouTubeOAuthClient,
	getYouTubeProfileForBucket,
} from "../domain/youtube_profiles.js";

const ROOT = process.cwd();
const DB_FILE = "db/evolution.db";
const METRICS = [
	"views",
	"engagedViews",
	"estimatedMinutesWatched",
	"averageViewDuration",
	"averageViewPercentage",
	"likes",
	"comments",
	"shares",
	"subscribersGained",
	"subscribersLost",
] as const;

type AnalyticsWindow = "published_day" | "first_7d";

type PublishedVideo = {
	runId: string;
	runDir: string;
	channelId: string;
	videoId: string;
	publishedAt: string;
	bucket: string;
	privacyStatus: string;
};

export interface AnalyticsRecord {
	video_id: string;
	channel_id: string;
	age_window: AnalyticsWindow;
	views: number;
	engaged_views: number;
	watch_time_minutes: number;
	average_view_duration_seconds: number;
	average_view_percentage: number;
	likes: number;
	comments: number;
	shares: number;
	subscribers_gained: number;
	subscribers_lost: number;
}

function isoDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
	const copy = new Date(date.getTime());
	copy.setUTCDate(copy.getUTCDate() + days);
	return copy;
}

export function eligibleWindows(
	publishedAt: string,
	now = new Date(),
): Array<{ name: AnalyticsWindow; startDate: string; endDate: string }> {
	const published = new Date(publishedAt);
	if (!Number.isFinite(published.getTime())) return [];
	const ageHours = (now.getTime() - published.getTime()) / 3_600_000;
	const startDate = isoDate(published);
	const windows: Array<{
		name: AnalyticsWindow;
		startDate: string;
		endDate: string;
	}> = [];
	if (ageHours >= 48) {
		windows.push({ name: "published_day", startDate, endDate: startDate });
	}
	if (ageHours >= 8 * 24) {
		windows.push({
			name: "first_7d",
			startDate,
			endDate: isoDate(addUtcDays(published, 6)),
		});
	}
	return windows;
}

export function discoverVideos(baseDir = process.cwd()): PublishedVideo[] {
	const videos: PublishedVideo[] = [];
	const runsDir = path.join(baseDir, "runs");
	if (!fs.existsSync(runsDir)) return videos;
	for (const bucket of fs.readdirSync(runsDir)) {
		const bucketDir = path.join(runsDir, bucket);
		if (!fs.statSync(bucketDir).isDirectory()) continue;
		for (const runName of fs.readdirSync(bucketDir)) {
			const runDir = path.join(bucketDir, runName);
			if (!fs.statSync(runDir).isDirectory()) continue;
			const receiptPath = path.join(runDir, "publish", "receipt.json");
			if (!fs.existsSync(receiptPath)) continue;
			try {
				const receipt = fs.readJsonSync(receiptPath) as {
					youtube?: {
						video_id?: string;
						channel_id?: string;
						published_at?: string;
						privacy_status?: string;
					};
				};
				const youtube = receipt.youtube;
				if (!youtube?.video_id || !youtube.channel_id || !youtube.published_at)
					continue;
				const schedulePath = path.join(
					runDir,
					"publish",
					"schedule_attestation.json",
				);
				const schedule = fs.existsSync(schedulePath)
					? (fs.readJsonSync(schedulePath) as { publish_at?: string })
					: {};
				videos.push({
					runId: `${bucket}/${runName}`,
					runDir,
					channelId: youtube.channel_id,
					videoId: youtube.video_id,
					publishedAt: schedule.publish_at || youtube.published_at,
					bucket,
					privacyStatus: youtube.privacy_status || "unknown",
				});
			} catch (error) {
				console.warn(
					`Skipping unreadable receipt ${receiptPath}: ${(error as Error).message}`,
				);
			}
		}
	}
	return videos;
}

async function verifyAuthorizationAndVideo(
	auth: InstanceType<typeof google.auth.OAuth2>,
	expectedChannelId: string,
	videoId: string,
): Promise<boolean> {
	const youtube = google.youtube({ version: "v3", auth });
	const channels = await youtube.channels.list({
		mine: true,
		part: ["id"],
		maxResults: 1,
	});
	const actualChannelId = channels.data.items?.[0]?.id;
	if (actualChannelId !== expectedChannelId) {
		throw new Error(
			`Analytics authorization channel mismatch: expected ${expectedChannelId}, got ${actualChannelId || "missing"}`,
		);
	}
	const videos = await youtube.videos.list({
		part: ["id", "status"],
		id: [videoId],
	});
	return Boolean(videos.data.items?.[0]);
}

async function fetchAnalytics(
	auth: InstanceType<typeof google.auth.OAuth2>,
	channelId: string,
	videoId: string,
	window: { name: AnalyticsWindow; startDate: string; endDate: string },
	runDir: string,
): Promise<AnalyticsRecord> {
	const youtubeAnalytics = google.youtubeAnalytics({ version: "v2", auth });
	const query = {
		ids: `channel==${channelId}`,
		startDate: window.startDate,
		endDate: window.endDate,
		metrics: METRICS.join(","),
		dimensions: "video",
		filters: `video==${videoId}`,
	};
	const response = await youtubeAnalytics.reports.query(query);
	const raw = {
		source: "YouTube Analytics API reports.query",
		retrieved_at: new Date().toISOString(),
		query,
		response: response.data,
	};
	const analyticsDir = path.join(runDir, "analytics");
	fs.ensureDirSync(analyticsDir);
	fs.writeJsonSync(path.join(analyticsDir, `${window.name}.json`), raw, {
		spaces: 2,
	});

	const row = response.data.rows?.[0];
	if (!row)
		throw new Error(
			`No analytics data returned for ${videoId} / ${window.name}`,
		);
	return {
		video_id: videoId,
		channel_id: channelId,
		age_window: window.name,
		views: Number(row[1] || 0),
		engaged_views: Number(row[2] || 0),
		watch_time_minutes: Number(row[3] || 0),
		average_view_duration_seconds: Number(row[4] || 0),
		average_view_percentage: Number(row[5] || 0),
		likes: Number(row[6] || 0),
		comments: Number(row[7] || 0),
		shares: Number(row[8] || 0),
		subscribers_gained: Number(row[9] || 0),
		subscribers_lost: Number(row[10] || 0),
	};
}

function ensureAnalyticsColumns(db: Database) {
	const columns = new Set(
		(
			db.query("PRAGMA table_info(youtube_analytics)").all() as Array<{
				name: string;
			}>
		).map((row) => row.name),
	);
	for (const [name, type] of [
		["engaged_views", "INTEGER"],
		["subscribers_gained", "INTEGER"],
		["subscribers_lost", "INTEGER"],
	] as const) {
		if (!columns.has(name))
			db.exec(`ALTER TABLE youtube_analytics ADD COLUMN ${name} ${type}`);
	}
}

export function saveAnalyticsRecord(db: Database, record: AnalyticsRecord) {
	ensureAnalyticsColumns(db);
	const insert = db.prepare(`
		INSERT INTO youtube_analytics (
			video_id, channel_id, age_window, views, engaged_views,
			watch_time_minutes, average_view_duration_seconds, average_view_percentage,
			likes, comments, shares, subscribers_gained, subscribers_lost, recorded_at
		) VALUES (
			$video_id, $channel_id, $age_window, $views, $engaged_views,
			$watch_time_minutes, $average_view_duration_seconds, $average_view_percentage,
			$likes, $comments, $shares, $subscribers_gained, $subscribers_lost,
			datetime('now')
		) ON CONFLICT(video_id, age_window) DO UPDATE SET
			views = excluded.views,
			engaged_views = excluded.engaged_views,
			watch_time_minutes = excluded.watch_time_minutes,
			average_view_duration_seconds = excluded.average_view_duration_seconds,
			average_view_percentage = excluded.average_view_percentage,
			likes = excluded.likes,
			comments = excluded.comments,
			shares = excluded.shares,
			subscribers_gained = excluded.subscribers_gained,
			subscribers_lost = excluded.subscribers_lost,
			recorded_at = datetime('now')
	`);
	insert.run({
		$video_id: record.video_id,
		$channel_id: record.channel_id,
		$age_window: record.age_window,
		$views: record.views,
		$engaged_views: record.engaged_views,
		$watch_time_minutes: record.watch_time_minutes,
		$average_view_duration_seconds: record.average_view_duration_seconds,
		$average_view_percentage: record.average_view_percentage,
		$likes: record.likes,
		$comments: record.comments,
		$shares: record.shares,
		$subscribers_gained: record.subscribers_gained,
		$subscribers_lost: record.subscribers_lost,
	});
}

async function main() {
	console.log("=== YouTube Analytics ingestion (raw API metrics only) ===");
	const videos = discoverVideos();
	if (videos.length === 0) {
		console.log("No published videos found in runs directory.");
		return;
	}
	const db = new Database(DB_FILE);
	try {
		for (const video of videos) {
			const windows = eligibleWindows(video.publishedAt);
			if (windows.length === 0) continue;
			const profile = getYouTubeProfileForBucket(video.bucket);
			try {
				const { auth } = await createYouTubeOAuthClient(profile.profileName);
				if (video.channelId !== profile.expectedChannelId) {
					throw new Error(
						`Receipt channel mismatch for ${video.videoId}: expected ${profile.expectedChannelId}, got ${video.channelId}`,
					);
				}
				const exists = await verifyAuthorizationAndVideo(
					auth,
					profile.expectedChannelId,
					video.videoId,
				);
				if (!exists) {
					db.prepare("DELETE FROM youtube_analytics WHERE video_id = ?").run(
						video.videoId,
					);
					fs.removeSync(path.join(video.runDir, "analytics"));
					console.warn(
						`Deleted stale analytics because video no longer exists: ${video.videoId}`,
					);
					continue;
				}
				for (const window of windows) {
					const record = await fetchAnalytics(
						auth,
						profile.expectedChannelId,
						video.videoId,
						window,
						video.runDir,
					);
					saveAnalyticsRecord(db, record);
					console.log(
						`[SUCCESS] ${video.videoId} ${window.name}: ${record.views} views, ${record.engaged_views} engaged views`,
					);
				}
			} catch (error) {
				console.error(
					`[FAIL_CLOSED] ${video.videoId} (${profile.profileName}): ${(error as Error).message}`,
				);
			}
		}
	} finally {
		db.close();
	}
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
