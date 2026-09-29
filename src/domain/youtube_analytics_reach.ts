export interface ReachReportMetadata {
	id: string;
	jobId: string;
	startTime: string;
	endTime: string;
	createTime: string;
	downloadUrl: string;
}

export interface ReachReportRow {
	video_id: string;
	channel_id: string;
	report_date: string;
	thumbnail_impressions: number;
	thumbnail_impressions_ctr: number;
}

const REQUIRED_COLUMNS = [
	"video_id",
	"channel_id",
	"date",
	"video_thumbnail_impressions",
	"video_thumbnail_impressions_ctr",
] as const;
const REPORT_DAY_MS = 86_400_000;
const PST_OFFSET_MS = 8 * 60 * 60 * 1_000;

function parseCsvRecords(csv: string): string[][] {
	const records: string[][] = [];
	let record: string[] = [];
	let field = "";
	let quoted = false;
	let closedQuote = false;

	for (let index = 0; index < csv.length; index += 1) {
		const character = csv.charAt(index);
		if (quoted) {
			if (character === '"') {
				if (csv[index + 1] === '"') {
					field += '"';
					index += 1;
				} else {
					quoted = false;
					closedQuote = true;
				}
			} else {
				field += character;
			}
			continue;
		}

		if (
			closedQuote &&
			character !== "," &&
			character !== "\r" &&
			character !== "\n"
		) {
			throw new Error("Malformed channel reach CSV quoting");
		}
		if (character === '"') {
			if (field.length > 0 || closedQuote) {
				throw new Error("Malformed channel reach CSV quoting");
			}
			quoted = true;
			continue;
		}
		if (character === ",") {
			record.push(field);
			field = "";
			closedQuote = false;
			continue;
		}
		if (character === "\r" || character === "\n") {
			record.push(field);
			if (!record.every((value) => value === "")) records.push(record);
			record = [];
			field = "";
			closedQuote = false;
			if (character === "\r" && csv[index + 1] === "\n") index += 1;
			continue;
		}
		field += character;
	}

	if (quoted) throw new Error("Malformed channel reach CSV quoting");
	if (record.length > 0 || field.length > 0 || closedQuote) {
		record.push(field);
		if (!record.every((value) => value === "")) records.push(record);
	}
	if (records.length === 0) {
		throw new Error("Channel reach CSV is missing its header row");
	}
	return records;
}

function isCalendarDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return (
		Number.isFinite(parsed.getTime()) &&
		parsed.toISOString().slice(0, 10) === value
	);
}

function parseNonNegativeNumber(value: string, column: string): number {
	if (!value.trim())
		throw new Error(`Invalid ${column} in channel reach report`);
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(`Invalid ${column} in channel reach report`);
	}
	return parsed;
}

export function parseReachReportCsv(csv: string): ReachReportRow[] {
	const records = parseCsvRecords(csv.replace(/^\uFEFF/, ""));
	const headerRecord = records[0];
	if (!headerRecord)
		throw new Error("Channel reach CSV is missing its header row");
	const header = headerRecord.map((value) => value.trim());
	const columns = new Map<string, number>();
	for (const [index, name] of header.entries()) {
		if (columns.has(name)) {
			throw new Error(`Duplicate channel reach column: ${name}`);
		}
		columns.set(name, index);
	}
	for (const name of REQUIRED_COLUMNS) {
		if (!columns.has(name)) {
			throw new Error(`Missing required channel reach column: ${name}`);
		}
	}

	const rows: ReachReportRow[] = [];
	const seen = new Set<string>();
	for (const values of records.slice(1)) {
		if (values.length !== header.length) {
			throw new Error(
				`Malformed channel reach CSV row: expected ${header.length} columns, got ${values.length}`,
			);
		}
		const value = (name: (typeof REQUIRED_COLUMNS)[number]) => {
			const columnIndex = columns.get(name);
			if (columnIndex === undefined) {
				throw new Error(`Missing required channel reach column: ${name}`);
			}
			const cell = values[columnIndex];
			if (cell === undefined) {
				throw new Error(`Malformed channel reach CSV row: missing ${name}`);
			}
			return cell;
		};
		const videoId = value("video_id").trim();
		const channelId = value("channel_id").trim();
		const reportDate = value("date").trim();
		if (!videoId || !channelId) {
			throw new Error("Channel reach rows require video_id and channel_id");
		}
		if (!isCalendarDate(reportDate)) {
			throw new Error(`Invalid channel reach report date: ${reportDate}`);
		}
		const impressions = parseNonNegativeNumber(
			value("video_thumbnail_impressions"),
			"video_thumbnail_impressions",
		);
		if (!Number.isSafeInteger(impressions)) {
			throw new Error(
				"Invalid video_thumbnail_impressions in channel reach report",
			);
		}
		const clickRate = parseNonNegativeNumber(
			value("video_thumbnail_impressions_ctr"),
			"video_thumbnail_impressions_ctr",
		);
		const key = `${channelId}\0${videoId}\0${reportDate}`;
		if (seen.has(key)) {
			throw new Error(
				`Duplicate channel reach row: ${channelId}/${videoId}/${reportDate}`,
			);
		}
		seen.add(key);
		rows.push({
			video_id: videoId,
			channel_id: channelId,
			report_date: reportDate,
			thumbnail_impressions: impressions,
			thumbnail_impressions_ctr: clickRate,
		});
	}
	return rows;
}

export function getReachReportDate(report: ReachReportMetadata): string {
	const start = new Date(report.startTime);
	const end = new Date(report.endTime);
	if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
		throw new Error(`Invalid channel reach report period: ${report.id}`);
	}
	if (
		start.toISOString().slice(11) !== "08:00:00.000Z" ||
		end.getTime() - start.getTime() !== REPORT_DAY_MS
	) {
		throw new Error(
			`Channel reach report must cover one fixed-PST day: ${report.id}`,
		);
	}
	const date = new Date(start.getTime() - PST_OFFSET_MS)
		.toISOString()
		.slice(0, 10);
	if (
		!report.id ||
		!report.jobId ||
		!report.createTime ||
		!report.downloadUrl
	) {
		throw new Error("Channel reach report metadata is incomplete");
	}
	const created = new Date(report.createTime);
	if (!Number.isFinite(created.getTime())) {
		throw new Error(`Invalid channel reach report creation time: ${report.id}`);
	}
	const url = new URL(report.downloadUrl);
	if (
		url.protocol !== "https:" ||
		url.hostname !== "youtubereporting.googleapis.com" ||
		!url.pathname.startsWith("/v1/media/")
	) {
		throw new Error(
			`Unexpected channel reach report download URL: ${report.id}`,
		);
	}
	return date;
}

export function selectLatestReachReports(
	reports: readonly ReachReportMetadata[],
	processedReportIds: ReadonlySet<string>,
): ReachReportMetadata[] {
	const latestByDate = new Map<
		string,
		{ report: ReachReportMetadata; createdAt: number }
	>();
	for (const report of reports) {
		const date = getReachReportDate(report);
		const createdAt = new Date(report.createTime).getTime();
		const previous = latestByDate.get(date);
		if (!previous || createdAt > previous.createdAt) {
			latestByDate.set(date, { report, createdAt });
		} else if (
			createdAt === previous.createdAt &&
			report.id !== previous.report.id
		) {
			throw new Error(`Ambiguous channel reach report revisions for ${date}`);
		}
	}
	return [...latestByDate.entries()]
		.filter(([, value]) => !processedReportIds.has(value.report.id))
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([, value]) => value.report);
}
