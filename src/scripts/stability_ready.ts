import path from "node:path";
import fs from "fs-extra";
import {
	STABILITY_BUCKETS,
	findRunDirsForDate,
	getLatestDailyLogs,
	isEvidenceReady,
} from "../io/utils/stability.js";

type RunEvidenceStatus = {
	date: string;
	log_path: string;
	present_buckets: string[];
	evidence_ready: boolean;
	evidence_paths: string[];
	missing_paths: string[];
	absent_buckets: string[];
};

const ROOT = process.cwd();
const PROOF_FILE = "run_evidence.json";

function collectPresentBuckets(date: string): string[] {
	return STABILITY_BUCKETS.filter(
		(bucket) => findRunDirsForDate(bucket, date).length > 0,
	);
}

function collectProofPaths(date: string, presentBuckets: string[]): string[] {
	return presentBuckets.flatMap((bucket) =>
		findRunDirsForDate(bucket, date)
			.map((runDir) => path.join(runDir, PROOF_FILE))
			.filter((candidate) => fs.existsSync(candidate)),
	);
}

function collectMissingProofPaths(
	date: string,
	presentBuckets: string[],
): string[] {
	return presentBuckets.flatMap((bucket) =>
		findRunDirsForDate(bucket, date)
			.map((runDir) => path.relative(path.join(ROOT, "runs"), runDir))
			.map((relativeRunDir) => path.join(relativeRunDir, PROOF_FILE))
			.filter(
				(relativePath) => !fs.existsSync(path.join(ROOT, "runs", relativePath)),
			),
	);
}

function buildStatus(logPath: string): RunEvidenceStatus {
	const date = path.basename(logPath, ".log");
	const present_buckets = collectPresentBuckets(date);
	const evidence_paths = collectProofPaths(date, present_buckets);
	const absent_buckets = STABILITY_BUCKETS.filter(
		(bucket) => !present_buckets.includes(bucket),
	);
	return {
		date,
		log_path: logPath,
		present_buckets,
		evidence_ready:
			present_buckets.length > 0 &&
			present_buckets.every((bucket) =>
				findRunDirsForDate(bucket, date).every((runDir) =>
					isEvidenceReady(runDir),
				),
			),
		evidence_paths,
		missing_paths: collectMissingProofPaths(date, present_buckets),
		absent_buckets,
	};
}

function formatMarkdown(statuses: RunEvidenceStatus[]): string {
	const lines: string[] = [];
	lines.push("# Stability Readiness");
	lines.push("");
	lines.push(`Generated: ${new Date().toISOString()}`);
	lines.push("");
	lines.push("## Latest 3 Daily Runs");
	for (const item of statuses.slice(0, 3)) {
		lines.push("");
		lines.push(`### ${item.date}`);
		lines.push(`- Log: \`${item.log_path}\``);
		lines.push(
			`- Present buckets: ${item.present_buckets.length > 0 ? item.present_buckets.map((p) => `\`${p}\``).join(", ") : "(none found)"}`,
		);
		lines.push(`- Evidence ready: \`${item.evidence_ready ? "yes" : "no"}\``);
		lines.push(
			`- Evidence: ${item.evidence_paths.length > 0 ? item.evidence_paths.map((p) => `\`${p}\``).join(", ") : "(none found)"}`,
		);
		if (item.absent_buckets.length > 0) {
			lines.push(
				`- Absent buckets: ${item.absent_buckets.map((p) => `\`${p}\``).join(", ")}`,
			);
		}
		if (item.missing_paths.length > 0) {
			lines.push(
				`- Missing: ${item.missing_paths
					.slice(0, 6)
					.map((p) => `\`${p}\``)
					.join(", ")}`,
			);
		}
	}
	lines.push("");
	lines.push("## Readiness");
	lines.push(
		`- ready: ${statuses.slice(0, 3).every((item) => item.evidence_ready) ? "yes" : "no"}`,
	);
	lines.push(`- checked_runs: ${Math.min(statuses.length, 3)}`);
	lines.push(
		`- all_latest_runs_have_run_dirs: ${statuses.slice(0, 3).every((item) => item.present_buckets.length > 0) ? "yes" : "no"}`,
	);
	return lines.join("\n");
}

async function main() {
	const logs = getLatestDailyLogs(3);
	const statuses = logs.map(buildStatus);
	const markdown = formatMarkdown(statuses);
	const outDir = path.join(ROOT, "logs");
	await fs.ensureDir(outDir);
	await fs.writeJson(path.join(outDir, "stability_ready.json"), statuses, {
		spaces: 2,
	});
	await fs.writeFile(path.join(outDir, "stability_ready.md"), `${markdown}\n`);
	console.log(markdown);
	if (
		statuses.length < 3 ||
		statuses.slice(0, 3).some((item) => !item.evidence_ready)
	) {
		process.exit(1);
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
