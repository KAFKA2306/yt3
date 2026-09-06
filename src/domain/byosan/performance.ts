import { Database } from "bun:sqlite";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import {
	ByosanFeatureSpecSchema,
	type ByosanFeatureSpec,
} from "./feature_spec.js";
import {
	ByosanProductionFormatSchema,
	type ByosanProductionFormat,
} from "./news_angle.js";

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
	watchTimeMinutesAverage: z.number(),
	averageViewPercentage: z.number(),
	subscribersGainedAverage: z.number(),
});

export const ByosanPerformanceSummarySchema = z.object({
	schemaVersion: z.literal("byosan_performance_v1"),
	status: z.enum(["READY", "INSUFFICIENT_DATA"]),
	window: z.literal("first_7d"),
	sampleCount: z.number().int().min(0),
	minSamplesPerFormat: z.number().int().min(1),
	preferredFormat: ByosanProductionFormatSchema.optional(),
	groups: z.array(PerformanceGroupSchema),
	generatedAt: z.string().datetime(),
});

export type ByosanPerformanceSummary = z.infer<
	typeof ByosanPerformanceSummarySchema
>;

type RunAnalytics = {
	format: ByosanProductionFormat;
	packagingPattern: string;
	durationBucket: string;
	views: number;
	watchTimeMinutes: number;
	averageViewPercentage: number;
	subscribersGained: number;
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

function discoverByosanAnalytics(
	db: Database,
	root: string,
): RunAnalytics[] {
	const bucketDir = path.join(root, "runs", "byosan_money");
	if (!fs.existsSync(bucketDir)) return [];
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
			youtube?: { video_id?: string };
		};
		const videoId = receipt.youtube?.video_id;
		if (!videoId) continue;
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
			format: spec.production?.format ?? "regular",
			packagingPattern: packagingPattern(spec),
			durationBucket: durationBucket(totalDuration),
			views: parsedAnalytics.views,
			watchTimeMinutes: Number(parsedAnalytics.watch_time_minutes ?? 0),
			averageViewPercentage: Number(
				parsedAnalytics.average_view_percentage ?? 0,
			),
			subscribersGained: Number(parsedAnalytics.subscribers_gained ?? 0),
		});
	}
	return rows;
}

function average(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildByosanPerformanceSummary(
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
			return PerformanceGroupSchema.parse({
				format,
				packagingPattern: pattern,
				durationBucket: duration,
				sampleCount: items.length,
				viewsAverage: Number(
					average(items.map((item) => item.views)).toFixed(2),
				),
				watchTimeMinutesAverage: Number(
					average(items.map((item) => item.watchTimeMinutes)).toFixed(2),
				),
				averageViewPercentage: Number(
					average(items.map((item) => item.averageViewPercentage)).toFixed(2),
				),
				subscribersGainedAverage: Number(
					average(items.map((item) => item.subscribersGained)).toFixed(2),
				),
			});
		})
		.sort(
			(left, right) =>
				right.averageViewPercentage - left.averageViewPercentage ||
				right.watchTimeMinutesAverage - left.watchTimeMinutesAverage ||
				left.format.localeCompare(right.format),
		);

	const formatRows = new Map<ByosanProductionFormat, RunAnalytics[]>();
	for (const row of rows) {
		const bucket = formatRows.get(row.format) ?? [];
		bucket.push(row);
		formatRows.set(row.format, bucket);
	}
	const eligibleFormats = [...formatRows.entries()]
		.filter(([, items]) => items.length >= minSamplesPerFormat)
		.map(([format, items]) => ({
			format,
			sampleCount: items.length,
			averageViewPercentage: average(
				items.map((item) => item.averageViewPercentage),
			),
			watchTimeMinutesAverage: average(
				items.map((item) => item.watchTimeMinutes),
			),
		}))
		.sort(
			(left, right) =>
				right.averageViewPercentage - left.averageViewPercentage ||
				right.watchTimeMinutesAverage - left.watchTimeMinutesAverage ||
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

export function loadPreferredByosanFormat(
	root = process.cwd(),
): ByosanProductionFormat | undefined {
	const target = path.join(
		root,
		"data",
		"memory",
		"byosan_money",
		"performance_summary.json",
	);
	if (!fs.existsSync(target)) return undefined;
	const summary = ByosanPerformanceSummarySchema.parse(fs.readJsonSync(target));
	if (summary.status !== "READY") return undefined;
	return summary.preferredFormat;
}
