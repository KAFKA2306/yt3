import { readFile } from "node:fs/promises";
import path from "node:path";
import { auditGoalsSignalsMetricsPlan } from "../domain/productivity/goals_signals_metrics.js";

function parseInputPath(argv: string[]): string {
	if (argv.length !== 2 || argv[0] !== "--input" || !argv[1]?.trim()) return "";
	return argv[1];
}

export async function auditGoalsSignalsMetricsFile(inputPath: string) {
	const input = JSON.parse(await readFile(path.resolve(inputPath), "utf8"));
	return auditGoalsSignalsMetricsPlan(input);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
	const inputPath = parseInputPath(argv);
	if (!inputPath) {
		console.error(
			"usage: bun src/scripts/audit_goals_signals_metrics.ts --input <plan.json>",
		);
		return 2;
	}
	try {
		console.log(JSON.stringify(await auditGoalsSignalsMetricsFile(inputPath)));
		return 0;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

if (import.meta.main) process.exit(await main());
