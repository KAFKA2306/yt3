import path from "node:path";
import fs from "fs-extra";
import {
	STABILITY_BUCKETS,
	findRunDirsForDate,
	getMissingEvidence,
	isEvidenceReady,
} from "../io/utils/stability.js";

const ROOT = process.cwd();

type DailySummary = {
	date: string;
};

type WindowReport = {
	days: number;
	dates: number;
	runs: number;
	ready_runs: number;
	success_rate: number | null;
	missing_evidence: Record<string, string[]>;
};

type ImprovementReport = {
	generated_at: string;
	buckets: readonly string[];
	windows: {
		last_7_days: WindowReport;
		last_30_days: WindowReport;
	};
};

function ageDays(date: string): number {
	const timestamp = new Date(`${date}T00:00:00+09:00`).getTime();
	if (Number.isNaN(timestamp)) return Number.POSITIVE_INFINITY;
	return (Date.now() - timestamp) / 86_400_000;
}

function collectRunDirs(dates: string[]): string[] {
	const dirs = new Set<string>();
	for (const date of dates) {
		for (const bucket of STABILITY_BUCKETS) {
			for (const runDir of findRunDirsForDate(bucket, date)) dirs.add(runDir);
		}
	}
	return [...dirs];
}

function buildWindow(summaries: DailySummary[], days: number): WindowReport {
	const dates = summaries
		.filter((summary) => ageDays(summary.date) <= days)
		.map((summary) => summary.date);
	const runDirs = collectRunDirs(dates);
	const readyRuns = runDirs.filter(isEvidenceReady);
	const missingEvidence = Object.fromEntries(
		runDirs
			.map((runDir) => [path.relative(ROOT, runDir), getMissingEvidence(runDir)] as const)
			.filter(([, missing]) => missing.length > 0),
	);

	return {
		days,
		dates: dates.length,
		runs: runDirs.length,
		ready_runs: readyRuns.length,
		success_rate:
			runDirs.length > 0
				? Number(((readyRuns.length / runDirs.length) * 100).toFixed(2))
				: null,
		missing_evidence: missingEvidence,
	};
}

function formatWindow(label: string, report: WindowReport): string[] {
	return [
		`## ${label}`,
		`- Dates: ${report.dates}`,
		`- Runs: ${report.runs}`,
		`- Evidence-ready runs: ${report.ready_runs}`,
		`- Success rate: ${report.success_rate === null ? "N/A" : `${report.success_rate}%`}`,
		`- Runs with missing evidence: ${Object.keys(report.missing_evidence).length}`,
		"",
	];
}

async function main() {
	const summaryPath = path.join(ROOT, "logs", "stability_summary.json");
	const summaries: DailySummary[] = fs.existsSync(summaryPath)
		? fs.readJsonSync(summaryPath)
		: [];

	const report: ImprovementReport = {
		generated_at: new Date().toISOString(),
		buckets: STABILITY_BUCKETS,
		windows: {
			last_7_days: buildWindow(summaries, 7),
			last_30_days: buildWindow(summaries, 30),
		},
	};

	const markdown = [
		"# Improvement Report",
		"",
		`Generated: ${report.generated_at}`,
		`Buckets: ${report.buckets.map((bucket) => `\`${bucket}\``).join(", ")}`,
		"",
		...formatWindow("Last 7 days", report.windows.last_7_days),
		...formatWindow("Last 30 days", report.windows.last_30_days),
		"## Missing evidence",
		"",
		"```json",
		JSON.stringify(report.windows.last_7_days.missing_evidence, null, 2),
		"```",
		"",
	].join("\n");

	const outDir = path.join(ROOT, "logs");
	await fs.ensureDir(outDir);
	await fs.writeJson(path.join(outDir, "improvement_report.json"), report, {
		spaces: 2,
	});
	await fs.writeFile(path.join(outDir, "improvement_report.md"), markdown);
	console.log(markdown);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
