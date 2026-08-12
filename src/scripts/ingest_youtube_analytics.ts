import { Database } from "bun:sqlite";
import path from "node:path";
import dotenv from "dotenv";
import fs from "fs-extra";
import { google } from "googleapis";
import {
	YOUTUBE_PROFILES,
	type YouTubeProfileName,
} from "../domain/youtube_profiles.js";

const ROOT = process.cwd();
const DB_FILE = "db/evolution.db";

// Recorded baseline for 100x growth tracking
export const RECORDED_BASELINE = {
	byosan_money: {
		views_24h_median: 15,
		views_7d_median: 75,
		watch_time_minutes_median: 1.5,
		retention_percentage_median: 35.0,
		satisfaction_score_median: 0.02,
	},
	humanity_observatory: {
		views_24h_median: 8,
		views_7d_median: 40,
		watch_time_minutes_median: 0.8,
		retention_percentage_median: 45.0,
		satisfaction_score_median: 0.04,
	},
};

export interface AnalyticsRecord {
	video_id: string;
	channel_id: string;
	age_window: "24h" | "7d";
	views: number;
	watch_time_minutes: number;
	average_view_duration_seconds: number;
	average_view_percentage: number;
	likes: number;
	comments: number;
	shares: number;
	subscribers_net: number;
	satisfaction_score: number;
}

// Calculate satisfaction proxy: (likes + comments * 2 + shares * 5) / views
export function calculateSatisfactionScore(
	likes: number,
	comments: number,
	shares: number,
	views: number,
): number {
	if (views === 0) return 0;
	return Number(((likes + comments * 2 + shares * 5) / views).toFixed(4));
}

// Scans all run dirs for publish receipts
export function discoverVideos(baseDir = process.cwd()): Array<{
	runId: string;
	channelId: string;
	videoId: string;
	publishedAt: string;
	bucket: string;
}> {
	const videos: Array<{
		runId: string;
		channelId: string;
		videoId: string;
		publishedAt: string;
		bucket: string;
	}> = [];
	const runsDir = path.join(baseDir, "runs");
	if (!fs.existsSync(runsDir)) return videos;

	const buckets = fs.readdirSync(runsDir);
	for (const bucket of buckets) {
		const bucketDir = path.join(runsDir, bucket);
		if (!fs.statSync(bucketDir).isDirectory()) continue;

		const runNames = fs.readdirSync(bucketDir);
		for (const runName of runNames) {
			const runDir = path.join(bucketDir, runName);
			if (!fs.statSync(runDir).isDirectory()) continue;

			const receiptPath = path.join(runDir, "publish", "receipt.json");
			if (fs.existsSync(receiptPath)) {
				try {
					const receipt = fs.readJsonSync(receiptPath);
					const youtube = receipt.youtube;
					if (youtube?.video_id && youtube?.published_at) {
						videos.push({
							runId: `${bucket}/${runName}`,
							channelId: youtube.channel_id || "",
							videoId: youtube.video_id,
							publishedAt: youtube.published_at,
							bucket,
						});
					}
				} catch {}
			}
		}
	}
	return videos;
}

async function getOAuthClient(profileName: YouTubeProfileName) {
	const profile = YOUTUBE_PROFILES[profileName];
	const envPath = path.join(process.cwd(), profile.envFile);
	if (!fs.existsSync(envPath)) {
		throw new Error(`Profile env file missing: ${profile.envFile}`);
	}

	dotenv.config({ path: envPath, override: true });
	const clientId = process.env.YOUTUBE_CLIENT_ID;
	const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
	const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

	if (!clientId || !clientSecret || !refreshToken) {
		throw new Error(
			`Missing OAuth config in env file ${profile.envFile} (Client ID, Secret, or Refresh Token missing)`,
		);
	}

	const auth = new google.auth.OAuth2(
		clientId,
		clientSecret,
		process.env.YOUTUBE_REDIRECT_URI || "http://localhost:3000/oauth2callback",
	);
	auth.setCredentials({ refresh_token: refreshToken });
	return { auth, profile };
}

// Ingests analytics data for a specific video and channel
async function fetchAnalytics(
	auth: InstanceType<typeof google.auth.OAuth2>,
	channelId: string,
	videoId: string,
	ageWindow: "24h" | "7d",
): Promise<Omit<AnalyticsRecord, "satisfaction_score">> {
	const youtubeAnalytics = google.youtubeAnalytics({ version: "v2", auth });

	try {
		const response = await youtubeAnalytics.reports.query({
			ids: `channel==${channelId}`,
			startDate: "2000-01-01",
			endDate: new Intl.DateTimeFormat("en-CA", {
				timeZone: "Asia/Tokyo",
			}).format(new Date()),
			metrics:
				"views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares,subscriberCountGained,subscriberCountLost",
			dimensions: "video",
			filters: `video==${videoId}`,
		});

		const rows = response.data.rows;
		if (!rows || rows.length === 0) {
			throw new Error(`No analytics data returned for video ${videoId}`);
		}

		const row = rows[0];
		if (!row) {
			throw new Error(`Row data empty for video ${videoId}`);
		}
		const views = Number(row[1] || 0);
		const watchTimeMinutes = Number(row[2] || 0);
		const averageViewDurationSeconds = Number(row[3] || 0);
		const likes = Number(row[4] || 0);
		const comments = Number(row[5] || 0);
		const shares = Number(row[6] || 0);
		const gained = Number(row[7] || 0);
		const lost = Number(row[8] || 0);

		// Get video details for duration mapping to average view percentage
		const youtube = google.youtube({ version: "v3", auth });
		const details = await youtube.videos.list({
			part: ["contentDetails"],
			id: [videoId],
		});
		const durationISO = details.data.items?.[0]?.contentDetails?.duration || "";
		let videoDurationSeconds = 60;
		const durationMatch = durationISO.match(
			/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/,
		);
		if (durationMatch) {
			const hours = Number(durationMatch[1] || 0);
			const minutes = Number(durationMatch[2] || 0);
			const seconds = Number(durationMatch[3] || 0);
			videoDurationSeconds = hours * 3600 + minutes * 60 + seconds;
		}

		const averageViewPercentage =
			videoDurationSeconds > 0
				? Number(
						((averageViewDurationSeconds / videoDurationSeconds) * 100).toFixed(
							2,
						),
					)
				: 0;

		return {
			video_id: videoId,
			channel_id: channelId,
			age_window: ageWindow,
			views,
			watch_time_minutes: watchTimeMinutes,
			average_view_duration_seconds: averageViewDurationSeconds,
			average_view_percentage: averageViewPercentage,
			likes,
			comments,
			shares,
			subscribers_net: gained - lost,
		};
	} catch (error: unknown) {
		const e = error as Error & { code?: number };
		if (e.message?.includes("insufficientPermissions") || e.code === 403) {
			throw new Error(
				`YouTube Analytics API call failed due to INSUFFICIENT PERMISSIONS. Please ensure your OAuth token has the required scope: 'https://www.googleapis.com/auth/yt-analytics.readonly'. Original error: ${e.message}`,
			);
		}
		throw e;
	}
}

export function saveAnalyticsRecord(db: Database, record: AnalyticsRecord) {
	const insert = db.prepare(`
		INSERT INTO youtube_analytics (
			video_id, channel_id, age_window, views, watch_time_minutes,
			average_view_duration_seconds, average_view_percentage,
			likes, comments, shares, subscribers_net, satisfaction_score, recorded_at
		) VALUES (
			$video_id, $channel_id, $age_window, $views, $watch_time_minutes,
			$average_view_duration_seconds, $average_view_percentage,
			$likes, $comments, $shares, $subscribers_net, $satisfaction_score, datetime('now', 'localtime')
		) ON CONFLICT(video_id, age_window) DO UPDATE SET
			views = excluded.views,
			watch_time_minutes = excluded.watch_time_minutes,
			average_view_duration_seconds = excluded.average_view_duration_seconds,
			average_view_percentage = excluded.average_view_percentage,
			likes = excluded.likes,
			comments = excluded.comments,
			shares = excluded.shares,
			subscribers_net = excluded.subscribers_net,
			satisfaction_score = excluded.satisfaction_score,
			recorded_at = datetime('now', 'localtime')
	`);

	insert.run({
		$video_id: record.video_id,
		$channel_id: record.channel_id,
		$age_window: record.age_window,
		$views: record.views,
		$watch_time_minutes: record.watch_time_minutes,
		$average_view_duration_seconds: record.average_view_duration_seconds,
		$average_view_percentage: record.average_view_percentage,
		$likes: record.likes,
		$comments: record.comments,
		$shares: record.shares,
		$subscribers_net: record.subscribers_net,
		$satisfaction_score: record.satisfaction_score,
	});
}

async function main() {
	console.log("=== YouTube Analytics Ingestion & Feedback Loop ===");

	const videos = discoverVideos();
	if (videos.length === 0) {
		console.log("No published videos found in runs directory. Scan complete.");
		return;
	}

	const db = new Database(DB_FILE);
	const now = new Date();

	for (const video of videos) {
		const publishTime = new Date(video.publishedAt);
		const ageMs = now.getTime() - publishTime.getTime();
		const ageHours = ageMs / (1000 * 60 * 60);

		let ageWindow: "24h" | "7d" | null = null;
		if (ageHours >= 168) {
			ageWindow = "7d";
		} else if (ageHours >= 24) {
			ageWindow = "24h";
		}

		if (!ageWindow) {
			console.log(
				`Video ${video.videoId} is too fresh (${ageHours.toFixed(1)}h old), skipping.`,
			);
			continue;
		}

		console.log(
			`Processing video ${video.videoId} (${video.bucket}) for age window: ${ageWindow}`,
		);

		let profileName: YouTubeProfileName = "byosan";
		if (video.bucket.includes("humanity")) {
			profileName = "humanity";
		} else if (video.bucket.includes("yawa")) {
			profileName = "yawa";
		}

		try {
			const { auth, profile } = await getOAuthClient(profileName);

			console.log(
				`Fetching YouTube Analytics API data for ${video.videoId} on channel ${profile.expectedChannelTitle}...`,
			);
			const metrics = await fetchAnalytics(
				auth,
				profile.expectedChannelId,
				video.videoId,
				ageWindow,
			);
			const satisfaction_score = calculateSatisfactionScore(
				metrics.likes,
				metrics.comments,
				metrics.shares,
				metrics.views,
			);

			const record: AnalyticsRecord = {
				...metrics,
				satisfaction_score,
			};

			saveAnalyticsRecord(db, record);
			console.log(
				`[SUCCESS] Stored analytics for video ${video.videoId}: ${record.views} views, satisfaction: ${record.satisfaction_score}`,
			);
		} catch (error: unknown) {
			const e = error as Error & { code?: number };
			console.error(
				`[FAIL_CLOSED] Action required for video ${video.videoId} (${profileName}): ${e.message}`,
			);
			console.log(
				"Documenting missing scope: 'https://www.googleapis.com/auth/yt-analytics.readonly' on OAuth authorization.",
			);
		}
	}

	db.close();
}

if (require.main === module) {
	main().catch(console.error);
}
