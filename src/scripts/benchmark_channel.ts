import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import {
	BENCHMARK_VERSION,
	type BenchmarkCheck,
	type BenchmarkProduct,
	type ChannelBenchmarkSummary,
	evaluateByosanRun,
	evaluateHumanityRun,
	evaluateYawaCrossRun,
	evaluateYawaRun,
	lexiconMetricsToCheck,
	parseLexiconReport,
	type RunBenchmarkResult,
} from "../domain/benchmark/evaluators.js";
import { ROOT } from "../io/core.js";

const BUCKET_BY_PRODUCT: Record<BenchmarkProduct, string> = {
	byosan: "byosan_money",
	yawa: "yawa_archive",
	humanity: "humanity_observatory",
};

const RUN_DIR_FILTER: Record<BenchmarkProduct, RegExp> = {
	byosan: /^\d{4}-\d{2}-\d{2}-/,
	yawa: /^yawa-\d{4}-\d{2}-\d{2}/,
	humanity: /^music-\d{4}-\d{2}-\d{2}/,
};

function listRecentRunDirs(
	product: BenchmarkProduct,
	limit: number,
	specificRun?: string,
): string[] {
	const bucketDir = path.join(ROOT, "runs", BUCKET_BY_PRODUCT[product]);
	if (!fs.existsSync(bucketDir)) return [];
	if (specificRun) {
		const cleaned = specificRun.replace(`${BUCKET_BY_PRODUCT[product]}/`, "");
		const full = path.join(bucketDir, cleaned);
		if (!fs.existsSync(full)) {
			throw new Error(`Run directory not found: ${full}`);
		}
		return [full];
	}
	const pattern = RUN_DIR_FILTER[product];
	return fs
		.readdirSync(bucketDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && pattern.test(entry.name))
		.map((entry) => entry.name)
		.sort()
		.reverse()
		.slice(0, limit)
		.map((name) => path.join(bucketDir, name));
}

function runLexiconCheck(product: BenchmarkProduct): BenchmarkCheck {
	const proc = spawnSync(
		"uv",
		["run", "--no-project", "scripts/lexicon_report.py", product],
		{ cwd: ROOT, encoding: "utf8", timeout: 60_000 },
	);
	if (proc.status !== 0) {
		return {
			id: "lexicon_diversity",
			layer: "L1_DETERMINISTIC",
			status: "UNVERIFIED",
			severity: "warning",
			message: `lexicon_report.py exited ${proc.status}: ${(proc.stderr || proc.stdout).trim().slice(0, 200)}`,
		};
	}
	return lexiconMetricsToCheck(parseLexiconReport(proc.stdout));
}

function evaluateProduct(
	product: BenchmarkProduct,
	options: { limit: number; specificRun?: string; withLexicon: boolean },
): ChannelBenchmarkSummary {
	const runDirs = listRecentRunDirs(
		product,
		options.limit,
		options.specificRun,
	);
	const runs: RunBenchmarkResult[] = runDirs.map((dir) => {
		if (product === "byosan") return evaluateByosanRun(dir);
		if (product === "yawa") return evaluateYawaRun(dir, { repoRoot: ROOT });
		return evaluateHumanityRun(dir, { repoRoot: ROOT });
	});

	const cross_run_checks: BenchmarkCheck[] = [];
	if (product === "yawa") {
		cross_run_checks.push(...evaluateYawaCrossRun(runs));
	}
	if (options.withLexicon) {
		cross_run_checks.push(runLexiconCheck(product));
	}

	return {
		benchmark_version: BENCHMARK_VERSION,
		product,
		evaluated_at: new Date().toISOString(),
		runs_evaluated: runs.length,
		pass_count: runs.filter((r) => r.status === "PASS").length,
		fail_count: runs.filter((r) => r.status === "FAIL").length,
		unverified_count: runs.filter((r) => r.status === "UNVERIFIED").length,
		cross_run_checks,
		runs,
	};
}

function formatSummaryMarkdown(summaries: ChannelBenchmarkSummary[]): string {
	const lines: string[] = [];
	for (const summary of summaries) {
		lines.push(
			`## [${summary.product}] Benchmark v${summary.benchmark_version} (runs=${summary.runs_evaluated}: PASS=${summary.pass_count}, FAIL=${summary.fail_count}, UNVERIFIED=${summary.unverified_count})`,
		);
		for (const check of summary.cross_run_checks) {
			lines.push(
				`- [cross-run][${check.status}] ${check.id}: ${check.message}`,
			);
		}
		for (const run of summary.runs) {
			lines.push(
				`- **${run.run_id}** => \`${run.status}\` (critical_failures=${run.critical_failures}, warnings=${run.warnings})`,
			);
			for (const check of run.checks) {
				if (check.status !== "PASS") {
					lines.push(
						`  - [${check.status}/${check.severity}] ${check.id}: ${check.message}`,
					);
				}
			}
		}
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}

function main() {
	const args = process.argv.slice(2);
	const target = args[0] as BenchmarkProduct | "all" | undefined;
	if (!target || !["byosan", "yawa", "humanity", "all"].includes(target)) {
		console.error(
			"usage: benchmark_channel.ts <byosan|yawa|humanity|all> [--limit=5] [--run=<name>] [--json] [--with-lexicon] [--strict]",
		);
		process.exit(2);
	}
	let limit = 5;
	let specificRun: string | undefined;
	let asJson = false;
	let withLexicon = false;
	let strict = false;
	for (const arg of args.slice(1)) {
		if (arg.startsWith("--limit="))
			limit = Math.max(1, Number(arg.slice(8)) || 5);
		else if (arg.startsWith("--run=")) specificRun = arg.slice(6);
		else if (arg === "--json") asJson = true;
		else if (arg === "--with-lexicon") withLexicon = true;
		else if (arg === "--strict") strict = true;
	}

	const products: BenchmarkProduct[] =
		target === "all" ? ["byosan", "yawa", "humanity"] : [target];
	const summaries = products.map((product) =>
		evaluateProduct(product, { limit, specificRun, withLexicon }),
	);

	if (asJson) {
		console.log(
			JSON.stringify(
				summaries.length === 1 ? summaries[0] : summaries,
				null,
				2,
			),
		);
	} else {
		console.log(formatSummaryMarkdown(summaries));
	}

	if (strict && summaries.some((s) => s.fail_count > 0)) {
		process.exit(1);
	}
}

main();
