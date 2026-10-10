import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";

type CheckResult = {
	name: string;
	ok: boolean;
	message: string;
};

const ROOT = process.cwd();

function record(
	results: CheckResult[],
	name: string,
	ok: boolean,
	message: string,
) {
	results.push({ name, ok, message });
}

function checkYamlFile(results: CheckResult[], filePath: string) {
	try {
		const raw = fs.readFileSync(path.join(ROOT, filePath), "utf-8");
		yaml.load(raw);
		record(results, `yaml:${filePath}`, true, "parsed");
	} catch (error) {
		record(
			results,
			`yaml:${filePath}`,
			false,
			error instanceof Error ? error.message : String(error),
		);
	}
}

function checkFileContains(
	results: CheckResult[],
	filePath: string,
	needle: string,
) {
	try {
		const raw = fs.readFileSync(path.join(ROOT, filePath), "utf-8");
		const ok = raw.includes(needle);
		record(
			results,
			`contains:${filePath}`,
			ok,
			ok ? `found ${needle}` : `missing ${needle}`,
		);
	} catch (error) {
		record(
			results,
			`contains:${filePath}`,
			false,
			error instanceof Error ? error.message : String(error),
		);
	}
}

function checkShellSyntax(results: CheckResult[], filePath: string) {
	const shell = process.env.SHELL || "/bin/bash";
	const proc = spawnSync(shell, ["-n", path.join(ROOT, filePath)], {
		encoding: "utf-8",
	});
	record(
		results,
		`shell:${filePath}`,
		proc.status === 0,
		proc.status === 0
			? "syntax ok"
			: proc.stderr || proc.stdout || "syntax error",
	);
}

function runCommand(
	results: CheckResult[],
	name: string,
	command: string,
	args: string[],
) {
	const proc = spawnSync(command, args, {
		cwd: ROOT,
		encoding: "utf-8",
		env: process.env,
	});
	record(
		results,
		name,
		proc.status === 0,
		proc.status === 0
			? "ok"
			: proc.stderr || proc.stdout || `exit ${proc.status}`,
	);
}

function print(results: CheckResult[], jsonMode: boolean) {
	if (jsonMode) {
		console.log(JSON.stringify(results, null, 2));
		return;
	}

	for (const result of results) {
		const prefix = result.ok ? "OK" : "FAIL";
		console.log(`[${prefix}] ${result.name}: ${result.message}`);
	}
}

async function main() {
	const args = new Set(process.argv.slice(2));
	const quick = args.has("--quick");
	const jsonMode = args.has("--json");
	const full = args.has("--full") || !quick;

	const results: CheckResult[] = [];

	checkYamlFile(results, "config/default.yaml");
	checkYamlFile(results, "config/domains/byosan_money.yaml");
	checkYamlFile(results, "config/domains/humanity_observatory.yaml");
	checkFileContains(
		results,
		"config/domains/byosan_money.yaml",
		"視聴者に愛されることを最優先",
	);
	checkShellSyntax(results, "src/io/utils/infra/run_workflow_cron.sh");

	if (full) {
		runCommand(results, "tsc", "bun", ["x", "--bun", "tsc", "--noEmit"]);
		runCommand(results, "biome", "bun", [
			"x",
			"--bun",
			"biome",
			"check",
			"src",
		]);
		runCommand(results, "ontology", "bun", ["run", "audit:ontology"]);
	}

	print(results, jsonMode);

	if (results.some((result) => !result.ok)) {
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(
		error instanceof Error ? error.stack || error.message : String(error),
	);
	process.exit(1);
});
