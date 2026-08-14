import path from "node:path";
import fs from "fs-extra";
import {
	findRunDirsForDate,
	getLatestPublishedChannelUrls,
} from "../io/utils/stability.js";

type ReadinessItem = {
	date: string;
	log_path: string;
	evidence_ready: boolean;
	present_buckets?: string[];
	absent_buckets?: string[];
	evidence_missing?: string[];
};

type GuaranteeReport = {
	generated_at: string;
	metrics_doc_path: string;
	freshness_doc_path: string;
	stability_summary_path: string;
	latest_runs: ReadinessItem[];
	latest_channel_urls: Array<{
		channel_label: string;
		channel_title: string;
		run_id: string;
		public_url: string;
		proof_path: string;
		published_at?: string;
	}>;
	all_latest_runs_ready: boolean;
	all_latest_runs_have_run_dirs: boolean;
};

const ROOT = process.cwd();

function readJson<T>(filePath: string): T | undefined {
	if (!fs.existsSync(filePath)) return undefined;
	return fs.readJsonSync(filePath) as T;
}

function buildLatestRuns(): ReadinessItem[] {
	const summaryPath = path.join(ROOT, "logs", "stability_summary.json");
	const summaries = readJson<ReadinessItem[]>(summaryPath) || [];
	return summaries.slice(0, 3);
}

function formatMarkdown(report: GuaranteeReport): string {
	const lines: string[] = [];
	lines.push("# Daily Guarantee Status");
	lines.push("");
	lines.push(`Generated: ${report.generated_at}`);
	lines.push("");
	lines.push("## Evidence Index");
	lines.push(`- Metrics doc: \`${report.metrics_doc_path}\``);
	lines.push(`- Freshness doc: \`${report.freshness_doc_path}\``);
	lines.push(`- Stability summary: \`${report.stability_summary_path}\``);
	lines.push("");
	lines.push("## Latest 3 Runs");
	for (const item of report.latest_runs) {
		lines.push("");
		lines.push(`### ${item.date}`);
		lines.push(`- Log: \`${item.log_path}\``);
		lines.push(`- Evidence ready: \`${item.evidence_ready ? "yes" : "no"}\``);
		lines.push(
			`- Present buckets: ${item.present_buckets?.length ? item.present_buckets.map((p) => `\`${p}\``).join(", ") : "(unknown)"}`,
		);
		lines.push(
			`- Absent buckets: ${item.absent_buckets?.length ? item.absent_buckets.map((p) => `\`${p}\``).join(", ") : "(none)"}`,
		);
		const freshnessReports: string[] = [];
		for (const bucket of item.present_buckets || []) {
			for (const runDir of findRunDirsForDate(bucket, item.date)) {
				const reportPath = path.join(
					runDir,
					"audit",
					"creative_freshness_report.json",
				);
				if (fs.existsSync(reportPath)) {
					freshnessReports.push(`\`${path.relative(ROOT, reportPath)}\``);
				}
			}
		}
		if (freshnessReports.length > 0) {
			lines.push(`- Freshness reports: ${freshnessReports.join(", ")}`);
		}
		if (item.evidence_missing?.length) {
			lines.push(
				`- Missing evidence: ${item.evidence_missing
					.slice(0, 6)
					.map((p) => `\`${p}\``)
					.join(", ")}`,
			);
		}
	}
	lines.push("");
	lines.push("## Latest Channel URLs");
	if (report.latest_channel_urls.length === 0) {
		lines.push("- (no published URLs found)");
	} else {
		for (const item of report.latest_channel_urls) {
			lines.push(`- ${item.channel_label}: \`${item.public_url}\``);
			lines.push(`  - Channel title: \`${item.channel_title}\``);
			lines.push(`  - Run: \`${item.run_id}\``);
			lines.push(`  - Proof: \`${item.proof_path}\``);
		}
	}
	lines.push("");
	lines.push("## Current Verdict");
	lines.push(
		`- all_latest_runs_ready: \`${report.all_latest_runs_ready ? "yes" : "no"}\``,
	);
	lines.push(
		`- all_latest_runs_have_run_dirs: \`${report.all_latest_runs_have_run_dirs ? "yes" : "no"}\``,
	);
	return lines.join("\n");
}

async function main() {
	const metricsDocPath = path.join(
		ROOT,
		"docs",
		"content_freshness_metrics.md",
	);
	const freshnessDocPath = path.join(ROOT, "docs", "daily_guarantee.md");
	const stabilitySummaryPath = path.join(ROOT, "logs", "stability_summary.md");
	const latestRuns = buildLatestRuns();
	const latestChannelUrls = await getLatestPublishedChannelUrls();
	const report: GuaranteeReport = {
		generated_at: new Date().toISOString(),
		metrics_doc_path: metricsDocPath,
		freshness_doc_path: freshnessDocPath,
		stability_summary_path: stabilitySummaryPath,
		latest_runs: latestRuns,
		latest_channel_urls: latestChannelUrls,
		all_latest_runs_ready:
			latestRuns.length >= 3 && latestRuns.every((item) => item.evidence_ready),
		all_latest_runs_have_run_dirs:
			latestRuns.length >= 3 &&
			latestRuns.every((item) => (item.present_buckets?.length || 0) > 0),
	};

	const markdown = formatMarkdown(report);
	const outDir = path.join(ROOT, "logs");
	await fs.ensureDir(outDir);
	await fs.writeJson(path.join(outDir, "daily_guarantee_status.json"), report, {
		spaces: 2,
	});
	await fs.writeFile(
		path.join(outDir, "daily_guarantee_status.md"),
		`${markdown}\n`,
	);
	console.log(markdown);
	if (!report.all_latest_runs_ready && process.env.DAILY_LAST3 !== "1") {
		process.exit(1);
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
