export const FIRST_3S_RETENTION_FORMULA_VERSION =
	"youtube-audience-watch-ratio-at-3s-linear-v1" as const;

export interface AudienceRetentionSample {
	elapsed_video_time_ratio: number;
	audience_watch_ratio: number;
}

interface First3sEvidenceBase {
	source_metric: "audienceWatchRatio";
	source_dimension: "elapsedVideoTimeRatio";
	formula_version: typeof FIRST_3S_RETENTION_FORMULA_VERSION;
	target_elapsed_seconds: 3;
	target_elapsed_video_time_ratio: number | null;
	video_duration_seconds: number | null;
	sample_count: number;
	sampling_resolution_seconds: number | null;
	interpolation_interval: {
		lower_elapsed_video_time_ratio: number;
		upper_elapsed_video_time_ratio: number;
	} | null;
	semantics: "Absolute segment-watch ratio; replays can make this value exceed 1 and it is not unique-viewer survival probability.";
}

export type First3sAudienceWatchRatio = First3sEvidenceBase &
	(
		| {
				status: "DERIVED";
				value: number;
				method: "exact_sample" | "linear_interpolation";
		  }
		| {
				status: "UNAVAILABLE";
				value: null;
				reason:
					| "video_duration_unavailable"
					| "target_exceeds_video_duration"
					| "retention_curve_empty"
					| "target_before_first_sample"
					| "target_after_last_sample";
		  }
	);

const EXACT_SAMPLE_EPSILON = 1e-12;

export interface AudienceRetentionQueryInput {
	channelId: string;
	videoId: string;
	startDate: string;
	endDate: string;
}

function isCalendarDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return (
		Number.isFinite(parsed.getTime()) &&
		parsed.toISOString().slice(0, 10) === value
	);
}

export function buildAudienceRetentionQuery(
	input: AudienceRetentionQueryInput,
) {
	const channelId = input.channelId.trim();
	const videoId = input.videoId.trim();
	if (!channelId || !videoId) {
		throw new Error(
			"audience retention query requires one channel and video id",
		);
	}
	if (!isCalendarDate(input.startDate) || !isCalendarDate(input.endDate)) {
		throw new Error("audience retention query dates must use YYYY-MM-DD");
	}
	if (input.startDate > input.endDate) {
		throw new Error(
			"audience retention query startDate must not follow endDate",
		);
	}
	return {
		ids: `channel==${channelId}`,
		startDate: input.startDate,
		endDate: input.endDate,
		metrics: "audienceWatchRatio" as const,
		dimensions: "elapsedVideoTimeRatio" as const,
		filters: `video==${videoId}`,
	};
}

function validateSamples(
	samples: readonly AudienceRetentionSample[],
): AudienceRetentionSample[] {
	const sorted = samples.map((sample) => {
		if (
			!Number.isFinite(sample.elapsed_video_time_ratio) ||
			sample.elapsed_video_time_ratio < 0 ||
			sample.elapsed_video_time_ratio > 1
		) {
			throw new Error(
				"elapsedVideoTimeRatio must be finite and between 0 and 1",
			);
		}
		if (
			!Number.isFinite(sample.audience_watch_ratio) ||
			sample.audience_watch_ratio < 0
		) {
			throw new Error("audienceWatchRatio must be finite non-negative");
		}
		return { ...sample };
	});
	sorted.sort(
		(a, b) => a.elapsed_video_time_ratio - b.elapsed_video_time_ratio,
	);
	for (let index = 1; index < sorted.length; index += 1) {
		if (
			sorted[index]?.elapsed_video_time_ratio ===
			sorted[index - 1]?.elapsed_video_time_ratio
		) {
			throw new Error("duplicate elapsedVideoTimeRatio sample");
		}
	}
	return sorted;
}

function samplingResolutionSeconds(
	samples: readonly AudienceRetentionSample[],
	durationSeconds: number | null,
): number | null {
	if (durationSeconds === null || samples.length < 2) return null;
	const gaps = samples
		.slice(1)
		.map(
			(sample, index) =>
				(sample.elapsed_video_time_ratio -
					(samples[index]?.elapsed_video_time_ratio ?? 0)) *
				durationSeconds,
		)
		.sort((a, b) => a - b);
	const middle = Math.floor(gaps.length / 2);
	const median =
		gaps.length % 2 === 0
			? ((gaps[middle - 1] ?? 0) + (gaps[middle] ?? 0)) / 2
			: (gaps[middle] ?? 0);
	return Number(median.toFixed(9));
}

export function deriveAudienceWatchRatioAtThreeSeconds(
	durationSeconds: number | null,
	inputSamples: readonly AudienceRetentionSample[],
): First3sAudienceWatchRatio {
	if (
		durationSeconds !== null &&
		(!Number.isFinite(durationSeconds) || durationSeconds <= 0)
	) {
		throw new Error("video duration must be finite and positive");
	}
	const samples = validateSamples(inputSamples);
	const resolutionSeconds = samplingResolutionSeconds(samples, durationSeconds);
	const targetRatio = durationSeconds === null ? null : 3 / durationSeconds;
	const base: First3sEvidenceBase = {
		source_metric: "audienceWatchRatio",
		source_dimension: "elapsedVideoTimeRatio",
		formula_version: FIRST_3S_RETENTION_FORMULA_VERSION,
		target_elapsed_seconds: 3,
		target_elapsed_video_time_ratio: targetRatio,
		video_duration_seconds: durationSeconds,
		sample_count: samples.length,
		sampling_resolution_seconds: resolutionSeconds,
		interpolation_interval: null,
		semantics:
			"Absolute segment-watch ratio; replays can make this value exceed 1 and it is not unique-viewer survival probability.",
	};
	const unavailable = (
		reason: Extract<
			First3sAudienceWatchRatio,
			{ status: "UNAVAILABLE" }
		>["reason"],
	): First3sAudienceWatchRatio => ({
		...base,
		status: "UNAVAILABLE",
		value: null,
		reason,
	});

	if (durationSeconds === null)
		return unavailable("video_duration_unavailable");
	if (targetRatio === null || targetRatio > 1)
		return unavailable("target_exceeds_video_duration");
	if (samples.length === 0) return unavailable("retention_curve_empty");

	const exact = samples.find(
		(sample) =>
			Math.abs(sample.elapsed_video_time_ratio - targetRatio) <=
			EXACT_SAMPLE_EPSILON,
	);
	if (exact) {
		return {
			...base,
			status: "DERIVED",
			value: exact.audience_watch_ratio,
			method: "exact_sample",
		};
	}

	const upperIndex = samples.findIndex(
		(sample) => sample.elapsed_video_time_ratio > targetRatio,
	);
	if (upperIndex === 0) return unavailable("target_before_first_sample");
	if (upperIndex < 0) return unavailable("target_after_last_sample");
	const lower = samples[upperIndex - 1];
	const upper = samples[upperIndex];
	if (!lower || !upper) return unavailable("retention_curve_empty");
	const span = upper.elapsed_video_time_ratio - lower.elapsed_video_time_ratio;
	const fraction = (targetRatio - lower.elapsed_video_time_ratio) / span;
	const value =
		lower.audience_watch_ratio +
		fraction * (upper.audience_watch_ratio - lower.audience_watch_ratio);
	return {
		...base,
		status: "DERIVED",
		value: Number(value.toFixed(12)),
		method: "linear_interpolation",
		interpolation_interval: {
			lower_elapsed_video_time_ratio: lower.elapsed_video_time_ratio,
			upper_elapsed_video_time_ratio: upper.elapsed_video_time_ratio,
		},
	};
}

export function parseAudienceRetentionRows(
	columnHeaders: readonly { name?: string | null }[],
	rows: readonly (readonly unknown[])[],
): AudienceRetentionSample[] {
	if (rows.length === 0) return [];
	const elapsedIndex = columnHeaders.findIndex(
		(header) => header.name === "elapsedVideoTimeRatio",
	);
	const audienceWatchIndex = columnHeaders.findIndex(
		(header) => header.name === "audienceWatchRatio",
	);
	if (elapsedIndex < 0 || audienceWatchIndex < 0) {
		throw new Error(
			"audience retention response must include elapsedVideoTimeRatio and audienceWatchRatio columns",
		);
	}
	return rows.map((row) => {
		const parseMetricValue = (value: unknown): number => {
			if (typeof value === "number") return value;
			if (typeof value === "string" && value.trim() !== "")
				return Number(value);
			return Number.NaN;
		};
		const elapsedRatio = parseMetricValue(row[elapsedIndex]);
		const audienceWatchRatio = parseMetricValue(row[audienceWatchIndex]);
		if (!Number.isFinite(elapsedRatio)) {
			throw new Error("elapsedVideoTimeRatio must be finite");
		}
		if (!Number.isFinite(audienceWatchRatio) || audienceWatchRatio < 0) {
			throw new Error("audienceWatchRatio must be finite non-negative");
		}
		return {
			elapsed_video_time_ratio: elapsedRatio,
			audience_watch_ratio: audienceWatchRatio,
		};
	});
}

export function parseYouTubeDurationSeconds(
	duration: string | null | undefined,
): number | null {
	if (duration == null) return null;
	const match = duration.match(
		/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
	);
	if (!match || !match.slice(1).some((part) => part !== undefined)) {
		throw new Error(`invalid YouTube video duration: ${duration}`);
	}
	const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
	const totalSeconds =
		Number(days) * 86_400 +
		Number(hours) * 3_600 +
		Number(minutes) * 60 +
		Number(seconds);
	if (!Number.isFinite(totalSeconds)) {
		throw new Error(`invalid YouTube video duration: ${duration}`);
	}
	if (totalSeconds <= 0) return null;
	return totalSeconds;
}
