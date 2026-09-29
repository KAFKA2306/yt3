import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { google, type youtubereporting_v1 } from "googleapis";
import {
	MAX_AUTHORIZATION_AGE_DAYS,
	analyticsAuthorizationCutoff,
} from "../domain/youtube_analytics_policy.js";
import {
	type ReachReportMetadata,
	type ReachReportRow,
	getReachReportDate,
	parseReachReportCsv,
	selectLatestReachReports,
} from "../domain/youtube_analytics_reach.js";
import {
	YOUTUBE_PROFILES,
	type YouTubeProfileName,
	assertYouTubeChannelMatchesProfile,
	createYouTubeOAuthClient,
	getYouTubeProfile,
} from "../domain/youtube_profiles.js";
import { discoverVideos } from "./ingest_youtube_analytics.js";

const REPORT_TYPE_ID = "channel_reach_basic_a1";
const DB_FILE = "db/evolution.db";

type ReportingJob = youtubereporting_v1.Schema$Job;
type ReportingReport = youtubereporting_v1.Schema$Report;

export type ReachEpisode = {
	episode_id: string;
	video_id: string;
	channel_id: string;
};

export function ensureReachAnalyticsTables(db: Database) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS youtube_analytics_reach_daily (
			episode_id TEXT NOT NULL,
			video_id TEXT NOT NULL,
			channel_id TEXT NOT NULL,
			report_date TEXT NOT NULL,
			thumbnail_impressions INTEGER NOT NULL,
			thumbnail_impressions_ctr REAL NOT NULL,
			report_id TEXT NOT NULL,
			report_created_at TEXT NOT NULL,
			downloaded_at TEXT NOT NULL,
			PRIMARY KEY (channel_id, report_date, video_id)
		);
		CREATE TABLE IF NOT EXISTS youtube_analytics_reach_reports (
			report_id TEXT PRIMARY KEY,
			job_id TEXT NOT NULL,
			channel_id TEXT NOT NULL,
			report_date TEXT NOT NULL,
			report_created_at TEXT NOT NULL,
			source_row_count INTEGER NOT NULL,
			linked_row_count INTEGER NOT NULL,
			unlinked_row_count INTEGER NOT NULL,
			sha256 TEXT NOT NULL,
			downloaded_at TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_yt_analytics_reach_downloaded_at
			ON youtube_analytics_reach_daily(downloaded_at);
		CREATE INDEX IF NOT EXISTS idx_yt_analytics_reach_reports_channel_date
			ON youtube_analytics_reach_reports(channel_id, report_date);
	`);
}

export function persistReachReport(
	db: Database,
	input: {
		channelId: string;
		report: ReachReportMetadata;
		rows: readonly ReachReportRow[];
		episodes: readonly ReachEpisode[];
		sha256: string;
		downloadedAt?: string;
	},
): {
	sourceRowCount: number;
	linkedRowCount: number;
	unlinkedRowCount: number;
} {
	ensureReachAnalyticsTables(db);
	const date = getReachReportDate(input.report);
	if (!input.channelId.trim() || !/^[a-f0-9]{64}$/i.test(input.sha256)) {
		throw new Error("Channel reach report persistence metadata is invalid");
	}
	const episodeByVideo = new Map<string, ReachEpisode>();
	for (const episode of input.episodes) {
		if (episode.channel_id !== input.channelId) continue;
		const previous = episodeByVideo.get(episode.video_id);
		if (previous && previous.episode_id !== episode.episode_id) {
			throw new Error(
				`Ambiguous episode mapping for channel video ${episode.video_id}`,
			);
		}
		episodeByVideo.set(episode.video_id, episode);
	}

	const seen = new Set<string>();
	const linkedRows: Array<{ episode: ReachEpisode; row: ReachReportRow }> = [];
	for (const row of input.rows) {
		if (row.channel_id !== input.channelId || row.report_date !== date) {
			throw new Error(
				`Channel reach CSV row does not match report ${input.report.id}`,
			);
		}
		if (
			!Number.isSafeInteger(row.thumbnail_impressions) ||
			row.thumbnail_impressions < 0 ||
			!Number.isFinite(row.thumbnail_impressions_ctr) ||
			row.thumbnail_impressions_ctr < 0
		) {
			throw new Error(
				`Invalid parsed metrics in channel reach report ${input.report.id}`,
			);
		}
		if (seen.has(row.video_id)) {
			throw new Error(
				`Duplicate channel reach video row: ${row.video_id}/${date}`,
			);
		}
		seen.add(row.video_id);
		const episode = episodeByVideo.get(row.video_id);
		if (episode) linkedRows.push({ episode, row });
	}
	const downloadedAt = input.downloadedAt ?? new Date().toISOString();
	const save = db.transaction(() => {
		db.prepare(
			"DELETE FROM youtube_analytics_reach_daily WHERE channel_id = ? AND report_date = ?",
		).run(input.channelId, date);
		const insertRow = db.prepare(`
			INSERT INTO youtube_analytics_reach_daily (
				episode_id, video_id, channel_id, report_date,
				thumbnail_impressions, thumbnail_impressions_ctr,
				report_id, report_created_at, downloaded_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		for (const { episode, row } of linkedRows) {
			insertRow.run(
				episode.episode_id,
				row.video_id,
				input.channelId,
				date,
				row.thumbnail_impressions,
				row.thumbnail_impressions_ctr,
				input.report.id,
				input.report.createTime,
				downloadedAt,
			);
		}
		db.prepare(`
			INSERT INTO youtube_analytics_reach_reports (
				report_id, job_id, channel_id, report_date, report_created_at,
				source_row_count, linked_row_count, unlinked_row_count, sha256, downloaded_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(report_id) DO UPDATE SET
				job_id = excluded.job_id,
				channel_id = excluded.channel_id,
				report_date = excluded.report_date,
				report_created_at = excluded.report_created_at,
				source_row_count = excluded.source_row_count,
				linked_row_count = excluded.linked_row_count,
				unlinked_row_count = excluded.unlinked_row_count,
				sha256 = excluded.sha256,
				downloaded_at = excluded.downloaded_at
		`).run(
			input.report.id,
			input.report.jobId,
			input.channelId,
			date,
			input.report.createTime,
			input.rows.length,
			linkedRows.length,
			input.rows.length - linkedRows.length,
			input.sha256,
			downloadedAt,
		);
	});
	save();
	return {
		sourceRowCount: input.rows.length,
		linkedRowCount: linkedRows.length,
		unlinkedRowCount: input.rows.length - linkedRows.length,
	};
}

export function purgeReachAnalyticsPastAuthorizationDeadline(
	db: Database,
	now = new Date(),
	maxAgeDays = MAX_AUTHORIZATION_AGE_DAYS,
): number {
	ensureReachAnalyticsTables(db);
	const cutoff = analyticsAuthorizationCutoff(now, maxAgeDays).toISOString();
	const daily = db
		.prepare(
			"DELETE FROM youtube_analytics_reach_daily WHERE downloaded_at < ?",
		)
		.run(cutoff).changes;
	const reports = db
		.prepare(
			"DELETE FROM youtube_analytics_reach_reports WHERE downloaded_at < ?",
		)
		.run(cutoff).changes;
	return daily + reports;
}

function normalizeReport(report: ReportingReport): ReachReportMetadata {
	if (
		!report.id ||
		!report.jobId ||
		!report.startTime ||
		!report.endTime ||
		!report.createTime ||
		!report.downloadUrl
	) {
		throw new Error(
			"Reporting API returned incomplete channel reach report metadata",
		);
	}
	return {
		id: report.id,
		jobId: report.jobId,
		startTime: report.startTime,
		endTime: report.endTime,
		createTime: report.createTime,
		downloadUrl: report.downloadUrl,
	};
}

async function listAllJobs(
	client: ReturnType<typeof google.youtubereporting>,
): Promise<ReportingJob[]> {
	const jobs: ReportingJob[] = [];
	const seenTokens = new Set<string>();
	let pageToken: string | undefined;
	do {
		const response = await client.jobs.list({
			includeSystemManaged: true,
			pageSize: 100,
			...(pageToken ? { pageToken } : {}),
		});
		jobs.push(...(response.data.jobs ?? []));
		pageToken = response.data.nextPageToken ?? undefined;
		if (pageToken && seenTokens.has(pageToken)) {
			throw new Error("Reporting API repeated a jobs page token");
		}
		if (pageToken) seenTokens.add(pageToken);
	} while (pageToken);
	return jobs;
}

function findActiveReachJob(jobs: readonly ReportingJob[], now = new Date()) {
	const active = jobs.filter((job) => {
		if (job.reportTypeId !== REPORT_TYPE_ID) return false;
		if (job.expireTime === undefined || job.expireTime === null) return true;
		const expiration = new Date(job.expireTime).getTime();
		if (!Number.isFinite(expiration)) {
			throw new Error(
				`Reporting API returned an invalid job expiration: ${job.id ?? "unknown"}`,
			);
		}
		return expiration > now.getTime();
	});
	if (active.length > 1) {
		throw new Error(
			`Expected one active ${REPORT_TYPE_ID} job, found ${active.length}; resolve duplicate jobs before continuing`,
		);
	}
	return active[0] ?? null;
}

async function listAllReachReports(
	client: ReturnType<typeof google.youtubereporting>,
	jobId: string,
	startTimeAtOrAfter: string,
): Promise<ReachReportMetadata[]> {
	const reports: ReachReportMetadata[] = [];
	const seenTokens = new Set<string>();
	let pageToken: string | undefined;
	do {
		const response = await client.jobs.reports.list({
			jobId,
			pageSize: 100,
			startTimeAtOrAfter,
			...(pageToken ? { pageToken } : {}),
		});
		for (const report of response.data.reports ?? []) {
			reports.push(normalizeReport(report));
		}
		pageToken = response.data.nextPageToken ?? undefined;
		if (pageToken && seenTokens.has(pageToken)) {
			throw new Error("Reporting API repeated a reports page token");
		}
		if (pageToken) seenTokens.add(pageToken);
	} while (pageToken);
	return reports;
}

async function setupReachJob(profileName: YouTubeProfileName) {
	const { profile, auth } = await createYouTubeOAuthClient(profileName);
	await assertYouTubeChannelMatchesProfile(auth, profile);
	const reporting = google.youtubereporting({ version: "v1", auth });
	const existing = findActiveReachJob(await listAllJobs(reporting));
	if (existing) {
		if (!existing.id)
			throw new Error("Existing channel reach job is missing its ID");
		console.log(`Channel reach job already configured: ${existing.id}`);
		return;
	}

	const created = await reporting.jobs.create({
		requestBody: {
			name: `YT3 ${profile.expectedChannelId} channel reach daily`,
			reportTypeId: REPORT_TYPE_ID,
		},
	});
	if (created.data.reportTypeId !== REPORT_TYPE_ID || !created.data.id) {
		throw new Error(
			"Reporting API did not confirm the requested channel reach job",
		);
	}
	const verified = findActiveReachJob(await listAllJobs(reporting));
	if (verified?.id !== created.data.id) {
		throw new Error(
			"Channel reach job creation could not be verified by read-back",
		);
	}
	console.log(`Created and verified channel reach job: ${created.data.id}`);
}

async function ingestReachReports(profileName: YouTubeProfileName) {
	const { profile, auth } = await createYouTubeOAuthClient(profileName);
	await assertYouTubeChannelMatchesProfile(auth, profile);
	const reporting = google.youtubereporting({ version: "v1", auth });
	const job = findActiveReachJob(await listAllJobs(reporting));
	if (!job?.id) {
		throw new Error(
			`No active ${REPORT_TYPE_ID} job for ${profileName}; run task analytics:reach:setup PROFILE=${profileName} first`,
		);
	}

	const db = new Database(DB_FILE);
	try {
		ensureReachAnalyticsTables(db);
		const now = new Date();
		const cutoff = analyticsAuthorizationCutoff(now);
		const cutoffDate = cutoff.toISOString().slice(0, 10);
		const reports = await listAllReachReports(
			reporting,
			job.id,
			new Date(`${cutoffDate}T00:00:00.000Z`).toISOString(),
		);
		const recentReports = reports.filter(
			(report) => getReachReportDate(report) >= cutoffDate,
		);
		const processedIds = new Set(
			(
				db
					.query(
						"SELECT report_id FROM youtube_analytics_reach_reports WHERE channel_id = ? AND downloaded_at >= ?",
					)
					.all(profile.expectedChannelId, cutoff.toISOString()) as Array<{
					report_id: string;
				}>
			).map((row) => row.report_id),
		);
		const latestReports = selectLatestReachReports(recentReports, processedIds);
		const episodes = discoverVideos()
			.filter((video) => video.channelId === profile.expectedChannelId)
			.map((video) => ({
				episode_id: video.runId,
				video_id: video.videoId,
				channel_id: video.channelId,
			}));
		for (const report of latestReports) {
			if (report.jobId !== job.id) {
				throw new Error(
					`Report ${report.id} belongs to a different Reporting API job`,
				);
			}
			const response = await auth.request<string>({
				url: report.downloadUrl,
				responseType: "text",
			});
			if (typeof response.data !== "string") {
				throw new Error(
					`Reporting API returned a non-text download for ${report.id}`,
				);
			}
			const rows = parseReachReportCsv(response.data);
			const reportDate = getReachReportDate(report);
			if (rows.some((row) => row.report_date !== reportDate)) {
				throw new Error(
					`CSV dates do not match report period for ${report.id}`,
				);
			}
			const counts = persistReachReport(db, {
				channelId: profile.expectedChannelId,
				report,
				rows,
				episodes,
				sha256: createHash("sha256").update(response.data).digest("hex"),
				downloadedAt: new Date().toISOString(),
			});
			console.log(
				`[SUCCESS] ${profileName} ${reportDate} ${report.id}: ${counts.linkedRowCount}/${counts.sourceRowCount} rows linked to episodes (${counts.unlinkedRowCount} unlinked)`,
			);
		}
		const purged = purgeReachAnalyticsPastAuthorizationDeadline(db, now);
		console.log(
			`Channel reach refresh complete: processed=${latestReports.length} reports, purged=${purged} expired rows/receipts`,
		);
	} finally {
		db.close();
	}
}

async function main() {
	const [command, rawProfile] = process.argv.slice(2);
	if (command !== "setup" && command !== "ingest") {
		throw new Error("Usage: <setup|ingest> <byosan|yawa|humanity>");
	}
	if (!rawProfile || !(rawProfile in YOUTUBE_PROFILES)) {
		throw new Error(
			"An explicit PROFILE is required: byosan, yawa, or humanity",
		);
	}
	const profileName = getYouTubeProfile(rawProfile).profileName;
	if (command === "setup") await setupReachJob(profileName);
	else await ingestReachReports(profileName);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
