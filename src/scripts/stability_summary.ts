import path from "node:path";
import fs from "fs-extra";
import {
	STABILITY_BUCKETS,
	classifyLogText,
	findRunDirsForDate,
	getLatestDailyLogs,
	isEvidenceReady,
} from "../io/utils/stability.js";

type DailySummary = {
	date: string;
	status: string;
	log_path: string;
	evidence_ready: boolean;
	evidence_missing: string[];
	terminal_line: string;
	failure?: {
		disposition: string;
		category: string;
		matchedRule: string;
		message: string;
		retryable: boolean;
	};
	evidence_paths: string[];
};

type FailureEvent = {
	date: string;
	log_path: string;
	line: string;
	disposition: string;
	category: string;
	matchedRule: string;
	retryable: boolean;
};

const ROOT = process.cwd();
const PROOF_FILE = "run_evidence.json";

function collectEvidencePaths(date: string): string[] {
	const paths: string[] = [];
	for (const bucket of STABILITY_BUCKETS) {
		for (const runDir of findRunDirsForDate(bucket, date)) {
			const candidate = path.join(runDir, PROOF_FILE);
			if (fs.existsSync(candidate)) paths.push(candidate);
		}
	}
	return paths;
}

function collectMissingProof(date: string): string[] {
	const missing: string[] = [];
	for (const bucket of STABILITY_BUCKETS) {
		for (const runDir of findRunDirsForDate(bucket, date)) {
			const candidate = path.join(runDir, PROOF_FILE);
			if (fs.existsSync(candidate)) continue;
			missing.push(
				path.join(path.relative(path.join(ROOT, "runs"), runDir), PROOF_FILE),
			);
		}
	}
	return missing;
}

function buildSummary(logPath: string): DailySummary {
	const date = path.basename(logPath, ".log");
	const logText = fs.readFileSync(logPath, "utf8");
	const classified = classifyLogText(logText);
	const evidencePaths = collectEvidencePaths(date);
	const evidenceReady =
		evidencePaths.length > 0 &&
		STABILITY_BUCKETS.filter(
			(bucket) => findRunDirsForDate(bucket, date).length > 0,
		).every((bucket) =>
			findRunDirsForDate(bucket, date).every((runDir) =>
				isEvidenceReady(runDir),
			),
		);
	const failure =
		classified.failure?.category === "proof_gap" && evidenceReady
			? undefined
			: classified.failure;
	return {
		date,
		status: failure
			? classified.status
			: evidenceReady
				? "success"
				: classified.status,
		log_path: logPath,
		evidence_ready: evidenceReady,
		evidence_missing: collectMissingProof(date),
		terminal_line: classified.terminal_line,
		failure: failure
			? {
					disposition: failure.disposition,
					category: failure.category,
					matchedRule: failure.matchedRule,
					message: failure.message,
					retryable: failure.retryable,
				}
			: undefined,
		evidence_paths: evidencePaths,
	};
}

function collectFailureEvents(logPath: string): FailureEvent[] {
	const date = path.basename(logPath, ".log");
	const logText = fs.readFileSync(logPath, "utf8");
	return logText
		.split(/\r?\n/)
		.filter((line) =>
			/(CRASH:|PARSE_FAIL:|GENERATE_ERROR|TASK_FAIL:|run failed exit_code=|PUBLISH_BLOCKED|PIPELINE FAILED:|FAILED:|JSON Parse error:)/.test(
				line,
			),
		)
		.map((line) => {
			const classified = classifyLogText(line);
			return {
				date,
				log_path: logPath,
				line,
				disposition: classified.failure?.disposition || classified.status,
				category: classified.failure?.category || "unknown",
				matchedRule: classified.failure?.matchedRule || "unknown",
				retryable: classified.failure?.retryable || false,
			};
		});
}

function formatMarkdown(
	summaries: DailySummary[],
	failureEvents: FailureEvent[],
): string {
	const lines: string[] = [];
	lines.push("# Daily Stability Summary");
	lines.push("");
	lines.push(`Generated: ${new Date().toISOString()}`);
	lines.push("");

	lines.push("## Latest 3 Daily Runs");
	for (const item of summaries.slice(0, 3)) {
		lines.push("");
		lines.push(`### ${item.date}`);
		lines.push(`- Status: \`${item.status}\``);
		lines.push(`- Log: \`${item.log_path}\``);
		lines.push(`- Evidence ready: \`${item.evidence_ready ? "yes" : "no"}\``);
		lines.push(
			`- Evidence: ${item.evidence_paths.length > 0 ? item.evidence_paths.map((p) => `\`${p}\``).join(", ") : "(none found)"}`,
		);
		if (item.evidence_missing.length > 0) {
			lines.push(
				`- Missing evidence: ${item.evidence_missing
					.slice(0, 6)
					.map((p) => `\`${p}\``)
					.join(", ")}`,
			);
		}
		if (item.failure) {
			lines.push(`- Failure category: \`${item.failure.category}\``);
			lines.push(`- Disposition: \`${item.failure.disposition}\``);
			lines.push(`- Retryable: \`${item.failure.retryable ? "yes" : "no"}\``);
			lines.push(`- Terminal: \`${item.terminal_line}\``);
		}
	}

	lines.push("");
	lines.push("## 30-Day Failure Classification");
	const counts = new Map<string, number>();
	const dispositionCounts = new Map<string, number>();
	const retryableCounts = new Map<string, number>();
	for (const item of failureEvents) {
		counts.set(item.category, (counts.get(item.category) || 0) + 1);
		dispositionCounts.set(
			item.disposition,
			(dispositionCounts.get(item.disposition) || 0) + 1,
		);
		retryableCounts.set(
			item.retryable ? "retryable" : "non_retryable",
			(retryableCounts.get(item.retryable ? "retryable" : "non_retryable") ||
				0) + 1,
		);
	}
	for (const [key, count] of [...counts.entries()].sort(
		(a, b) => b[1] - a[1],
	)) {
		lines.push(`- ${key}: ${count}`);
	}

	lines.push("");
	lines.push("## Disposition Counts");
	for (const [key, count] of [...dispositionCounts.entries()].sort(
		(a, b) => b[1] - a[1],
	)) {
		lines.push(`- ${key}: ${count}`);
	}

	lines.push("");
	lines.push("## Retryability Counts");
	for (const [key, count] of [...retryableCounts.entries()].sort(
		(a, b) => b[1] - a[1],
	)) {
		lines.push(`- ${key}: ${count}`);
	}

	lines.push("");
	lines.push("## Evidence Readiness");
	const readinessCounts = new Map<string, number>();
	for (const item of summaries) {
		const key = item.evidence_ready ? "ready" : "missing";
		readinessCounts.set(key, (readinessCounts.get(key) || 0) + 1);
	}
	for (const [key, count] of [...readinessCounts.entries()].sort(
		(a, b) => b[1] - a[1],
	)) {
		lines.push(`- ${key}: ${count}`);
	}

	return lines.join("\n");
}

async function main() {
	const logs = getLatestDailyLogs(1000).filter((logPath) => {
		const date = path.basename(logPath, ".log");
		const timestamp = new Date(`${date}T00:00:00+09:00`).getTime();
		if (Number.isNaN(timestamp)) return false;
		const ageDays = (Date.now() - timestamp) / (24 * 60 * 60 * 1000);
		return ageDays <= 30;
	});
	if (logs.length === 0) {
		console.log("No daily logs found.");
		return;
	}

	const summaries = logs.map(buildSummary);
	const failureEvents = logs.flatMap(collectFailureEvents);
	const markdown = formatMarkdown(summaries, failureEvents);

	const outDir = path.join(ROOT, "logs");
	await fs.ensureDir(outDir);
	await fs.writeJson(path.join(outDir, "stability_summary.json"), summaries, {
		spaces: 2,
	});
	await fs.writeFile(
		path.join(outDir, "stability_summary.md"),
		`${markdown}\n`,
	);
	await fs.writeJson(
		path.join(outDir, "stability_failures.json"),
		failureEvents,
		{
			spaces: 2,
		},
	);
	console.log(markdown);
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
