import { Database } from "bun:sqlite";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import {
	type ByosanFeatureSpec,
	ByosanFeatureSpecSchema,
	ByosanProductionFormatSchema,
} from "./feature_spec.js";

type ByosanProductionFormat = z.infer<typeof ByosanProductionFormatSchema>;

const AnalyticsRowSchema = z.object({
	views: z.number(),
	watch_time_minutes: z.number().nullable().optional(),
	average_view_percentage: z.number().nullable().optional(),
	subscribers_gained: z.number().nullable().optional(),
});

const PerformanceGroupSchema = z.object({
	format: ByosanProductionFormatSchema,
	packagingPattern: z.string().min(1),
	durationBucket: z.string().min(1),
	sampleCount: z.number().int().min(1),
	viewsAverage: z.number(),
	watchTimeMinutesAverage: z.number().nullable(),
	averageViewPercentage: z.number().nullable(),
	thumbnailImpressionsCtr: z.number().nullable(),
	subscribersGainedAverage: z.number().nullable(),
	metricSampleCounts: z.object({
		watchTimeMinutes: z.number(),
		averageViewPercentage: z.number(),
		thumbnailImpressionsCtr: z.number(),
		subscribersGained: z.number(),
	}),
});

const PerformanceObservationSchema = z.object({
	runId: z.string().min(1),
	videoId: z.string().min(1),
	publishedAt: z.string().nullable(),
	format: ByosanProductionFormatSchema,
	packagingPattern: z.string().min(1),
	durationBucket: z.string().min(1),
	views: z.number(),
	watchTimeMinutes: z.number().nullable(),
	averageViewPercentage: z.number().nullable(),
	thumbnailImpressionsCtr: z.number().nullable(),
	subscribersGained: z.number().nullable(),
});

const ByosanPerformanceSummarySchema = z.object({
	schemaVersion: z.literal("byosan_performance_v1"),
	status: z.enum(["READY", "INSUFFICIENT_DATA"]),
	window: z.literal("first_7d"),
	sampleCount: z.number().int().min(0),
	minSamplesPerFormat: z.number().int().min(1),
	preferredFormat: ByosanProductionFormatSchema.optional(),
	observations: z.array(PerformanceObservationSchema),
	groups: z.array(PerformanceGroupSchema),
	generatedAt: z.string().datetime(),
});

type ByosanPerformanceSummary = z.infer<typeof ByosanPerformanceSummarySchema>;

type RunAnalytics = {
	runId: string;
	videoId: string;
	publishedAt: string | null;
	format: ByosanProductionFormat;
	packagingPattern: string;
	durationBucket: string;
	views: number;
	watchTimeMinutes: number | null;
	averageViewPercentage: number | null;
	thumbnailImpressionsCtr: number | null;
	subscribersGained: number | null;
};

function durationBucket(totalDurationSeconds: number): string {
	if (totalDurationSeconds < 7 * 60) return "lt_7m";
	if (totalDurationSeconds < 10 * 60) return "7_10m";
	return "gte_10m";
}

function packagingPattern(spec: ByosanFeatureSpec): string {
	const parts = [
		spec.packaging?.freshness ? "freshness" : null,
		spec.packaging?.relativeAnchor ? "relative" : null,
		spec.packaging?.impactClaimId ? "impact" : null,
	].filter(Boolean);
	return parts.length > 0 ? parts.join("+") : "plain";
}

function discoverByosanAnalytics(db: Database, root: string): RunAnalytics[] {
	const bucketDir = path.join(root, "runs", "byosan_money");
	if (!fs.existsSync(bucketDir)) return [];
	const reachTableExists = Boolean(
		db
			.query(
				"SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'youtube_analytics_reach_daily'",
			)
			.get(),
	);
	const rows: RunAnalytics[] = [];
	for (const runName of fs.readdirSync(bucketDir).sort()) {
		const runDir = path.join(bucketDir, runName);
		if (!fs.statSync(runDir).isDirectory()) continue;
		const receiptPath = path.join(runDir, "publish", "receipt.json");
		const specPath = path.join(runDir, "source", "feature_spec.json");
		const statePath = path.join(runDir, "state.json");
		if (
			!fs.existsSync(receiptPath) ||
			!fs.existsSync(specPath) ||
			!fs.existsSync(statePath)
		) {
			continue;
		}
		const receipt = fs.readJsonSync(receiptPath) as {
			youtube?: { video_id?: string; published_at?: string };
		};
		const videoId = receipt.youtube?.video_id;
		const publishedAt = receipt.youtube?.published_at;
		if (!videoId) continue;
		let thumbnailImpressionsCtr: number | null = null;
		if (publishedAt && reachTableExists) {
			const reach = db
				.query(
					`SELECT SUM(thumbnail_impressions * thumbnail_impressions_ctr) /
						NULLIF(SUM(thumbnail_impressions), 0) AS ctr
					 FROM youtube_analytics_reach_daily
					 WHERE video_id = ?
					   AND report_date >= date(?)
					   AND report_date < date(?, '+7 days')`,
				)
				.get(videoId, publishedAt, publishedAt) as
				| { ctr: number | null }
				| undefined;
			thumbnailImpressionsCtr = reach?.ctr ?? null;
		}
		const analytics = db
			.query(
				`SELECT views, watch_time_minutes, average_view_percentage, subscribers_gained
				 FROM youtube_analytics
				 WHERE video_id = ? AND age_window = 'first_7d'`,
			)
			.get(videoId);
		if (!analytics) continue;
		const parsedAnalytics = AnalyticsRowSchema.parse(analytics);
		const spec = ByosanFeatureSpecSchema.parse(fs.readJsonSync(specPath));
		const state = fs.readJsonSync(statePath) as {
			script?: { total_duration?: number };
		};
		const totalDuration = Number(state.script?.total_duration ?? 0);
		rows.push({
			runId: path.basename(runDir),
			videoId,
			publishedAt: publishedAt ?? null,
			format: spec.production?.format ?? "regular",
			packagingPattern: packagingPattern(spec),
			durationBucket: durationBucket(totalDuration),
			views: parsedAnalytics.views,
			watchTimeMinutes: parsedAnalytics.watch_time_minutes ?? null,
			averageViewPercentage: parsedAnalytics.average_view_percentage ?? null,
			thumbnailImpressionsCtr,
			subscribersGained: parsedAnalytics.subscribers_gained ?? null,
		});
	}
	return rows;
}

function average(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function observedAverage(values: (number | null)[]): {
	average: number | null;
	count: number;
} {
	const observed = values.filter((value): value is number => value !== null);
	return {
		average: observed.length ? Number(average(observed).toFixed(2)) : null,
		count: observed.length,
	};
}

function buildByosanPerformanceSummary(
	db: Database,
	root = process.cwd(),
	minSamplesPerFormat = 3,
	now = new Date(),
): ByosanPerformanceSummary {
	const rows = discoverByosanAnalytics(db, root);
	const grouped = new Map<string, RunAnalytics[]>();
	for (const row of rows) {
		const key = `${row.format}|${row.packagingPattern}|${row.durationBucket}`;
		const bucket = grouped.get(key) ?? [];
		bucket.push(row);
		grouped.set(key, bucket);
	}
	const groups = [...grouped.entries()]
		.map(([key, items]) => {
			const [format, pattern, duration] = key.split("|");
			const watch = observedAverage(items.map((item) => item.watchTimeMinutes));
			const retention = observedAverage(
				items.map((item) => item.averageViewPercentage),
			);
			const ctr = observedAverage(
				items.map((item) => item.thumbnailImpressionsCtr),
			);
			const subscribers = observedAverage(
				items.map((item) => item.subscribersGained),
			);
			return PerformanceGroupSchema.parse({
				format,
				packagingPattern: pattern,
				durationBucket: duration,
				sampleCount: items.length,
				viewsAverage: Number(
					average(items.map((item) => item.views)).toFixed(2),
				),
				watchTimeMinutesAverage: watch.average,
				averageViewPercentage: retention.average,
				thumbnailImpressionsCtr: ctr.average,
				subscribersGainedAverage: subscribers.average,
				metricSampleCounts: {
					watchTimeMinutes: watch.count,
					averageViewPercentage: retention.count,
					thumbnailImpressionsCtr: ctr.count,
					subscribersGained: subscribers.count,
				},
			});
		})
		.sort(
			(left, right) =>
				(right.averageViewPercentage ?? -Infinity) -
					(left.averageViewPercentage ?? -Infinity) ||
				(right.watchTimeMinutesAverage ?? -Infinity) -
					(left.watchTimeMinutesAverage ?? -Infinity) ||
				left.format.localeCompare(right.format),
		);

	const formatRows = new Map<ByosanProductionFormat, RunAnalytics[]>();
	for (const row of rows) {
		const bucket = formatRows.get(row.format) ?? [];
		bucket.push(row);
		formatRows.set(row.format, bucket);
	}
	const eligibleFormats = [...formatRows.entries()]
		.filter(
			([, items]) =>
				items.filter((item) => item.averageViewPercentage !== null).length >=
				minSamplesPerFormat,
		)
		.map(([format, items]) => ({
			format,
			sampleCount: items.length,
			averageViewPercentage: observedAverage(
				items.map((item) => item.averageViewPercentage),
			).average,
			watchTimeMinutesAverage: observedAverage(
				items.map((item) => item.watchTimeMinutes),
			).average,
		}))
		.sort(
			(left, right) =>
				(right.averageViewPercentage ?? -Infinity) -
					(left.averageViewPercentage ?? -Infinity) ||
				(right.watchTimeMinutesAverage ?? -Infinity) -
					(left.watchTimeMinutesAverage ?? -Infinity) ||
				left.format.localeCompare(right.format),
		);

	return ByosanPerformanceSummarySchema.parse({
		schemaVersion: "byosan_performance_v1",
		status: eligibleFormats.length > 0 ? "READY" : "INSUFFICIENT_DATA",
		window: "first_7d",
		sampleCount: rows.length,
		minSamplesPerFormat,
		...(eligibleFormats[0]?.format
			? { preferredFormat: eligibleFormats[0].format }
			: {}),
		observations: rows,
		groups,
		generatedAt: now.toISOString(),
	});
}

export function writeByosanPerformanceSummary(
	dbFile = path.join(process.cwd(), "db", "evolution.db"),
	root = process.cwd(),
	minSamplesPerFormat = 3,
): ByosanPerformanceSummary {
	const db = new Database(dbFile);
	try {
		const summary = buildByosanPerformanceSummary(
			db,
			root,
			minSamplesPerFormat,
		);
		const target = path.join(
			root,
			"data",
			"memory",
			"byosan_money",
			"performance_summary.json",
		);
		fs.outputJsonSync(target, summary, { spaces: 2 });
		return summary;
	} finally {
		db.close();
	}
}
