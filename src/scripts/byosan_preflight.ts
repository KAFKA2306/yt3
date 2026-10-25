import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { getByosanProductionConfig } from "../domain/byosan/production_config.js";
import { ROOT } from "../io/core.js";

type PreflightStatus = "PASS" | "FAIL";

export type PreflightCheck = {
	status: PreflightStatus;
	component: string;
	method: string;
	reason: string;
	evidence: string[];
};

export type ByosanPreflightDependencies = {
	commandAvailable?: (command: string) => PreflightCheck;
	nodeDependencies?: () => PreflightCheck;
	pythonRuntime?: (runDir: string) => PreflightCheck;
	voicevox?: () => Promise<PreflightCheck>;
};

export type ByosanPreflightReport = {
	schema_version: "byosan_production_preflight_v1";
	status: PreflightStatus;
	profile: "byosan";
	run_id: string;
	publication_attempted: false;
	generated_at: string;
	checks: Record<string, PreflightCheck>;
};

function check(
	component: string,
	method: string,
	status: PreflightStatus,
	reason: string,
	evidence: string[] = [],
): PreflightCheck {
	return { component, method, status, reason, evidence };
}

function commandAvailable(command: string): PreflightCheck {
	const result = spawnSync(command, ["-version"], {
		cwd: ROOT,
		stdio: "ignore",
	});
	return result.status === 0
		? check(command, `${command} -version`, "PASS", "command is available")
		: check(
				command,
				`${command} -version`,
				"FAIL",
				"required command is unavailable",
			);
}

const PackageJsonSchema = z.object({
	dependencies: z.record(z.string(), z.string()),
});
const BYOSAN_DOMAIN_DIR = path.join(ROOT, "src", "domain", "byosan");
const BYOSAN_IMPORT_ENTRY = path.join(
	ROOT,
	"src",
	"scripts",
	"produce_byosan_feature.ts",
);
const IMPORT_SPECIFIER = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

export function packageNameOf(specifier: string): string {
	const segments = specifier.split("/");
	return segments.slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
}

function importSpecifiers(text: string): string[] {
	return [...text.matchAll(IMPORT_SPECIFIER)]
		.map((match) => match[1])
		.filter((specifier): specifier is string => specifier !== undefined);
}

export function importedPackageNames(
	sourceTexts: string[],
	declaredPackages: string[],
): string[] {
	const declared = new Set(declaredPackages);
	const names = sourceTexts.flatMap((text) =>
		importSpecifiers(text).map(packageNameOf),
	);
	return [...new Set(names)].filter((name) => declared.has(name)).sort();
}

export function missingPackages(
	packages: string[],
	isInstalled: (name: string) => boolean,
): string[] {
	return packages.filter((name) => !isInstalled(name));
}

function declaredPackages(): string[] {
	const manifest = PackageJsonSchema.parse(
		fs.readJsonSync(path.join(ROOT, "package.json")),
	);
	return Object.keys(manifest.dependencies);
}

function byosanSourceTexts(): string[] {
	const domainFiles = fs
		.readdirSync(BYOSAN_DOMAIN_DIR, { recursive: true, encoding: "utf8" })
		.filter((file) => file.endsWith(".ts"))
		.map((file) => path.join(BYOSAN_DOMAIN_DIR, file));
	return [...domainFiles, BYOSAN_IMPORT_ENTRY].map((file) =>
		fs.readFileSync(file, "utf8"),
	);
}

function checkNodeDependencies(): PreflightCheck {
	const imported = importedPackageNames(
		byosanSourceTexts(),
		declaredPackages(),
	);
	const missing = missingPackages(imported, (name) =>
		fs.existsSync(path.join(ROOT, "node_modules", name, "package.json")),
	);
	return missing.length === 0
		? check(
				"node_dependencies",
				"package.json dependencies imported by Byosan resolve under node_modules",
				"PASS",
				`${imported.length} imported packages are installed`,
			)
		: check(
				"node_dependencies",
				"package.json dependencies imported by Byosan resolve under node_modules",
				"FAIL",
				`missing packages in node_modules: ${missing.join(", ")}; run bun install --frozen-lockfile`,
			);
}

function redacted(value: string): string {
	return value
		.replaceAll(/AIza[A-Za-z0-9_-]{16,}/g, "[REDACTED_KEY]")
		.replaceAll(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
		.slice(-1200);
}

function runPythonRuntime(runDir: string): PreflightCheck {
	const result = spawnSync(
		"uv",
		[
			"run",
			"--frozen",
			"python",
			"src/scripts/production_runtime_preflight.py",
			"--mode",
			"full",
		],
		{ cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
	);
	const evidence = path.join(runDir, "audit", "python_runtime_preflight.json");
	fs.ensureDirSync(path.dirname(evidence));
	const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
	fs.writeJsonSync(
		evidence,
		{
			command:
				"uv run --frozen python src/scripts/production_runtime_preflight.py --mode full",
			status: result.status === 0 ? "PASS" : "FAIL",
			output: redacted(output),
		},
		{ spaces: 2 },
	);
	return result.status === 0
		? check(
				"python_runtime",
				"production_runtime_preflight.py --mode full",
				"PASS",
				"Python imports, cache policy, and SpeechBrain encoder passed",
				[evidence],
			)
		: check(
				"python_runtime",
				"production_runtime_preflight.py --mode full",
				"FAIL",
				`Python production runtime failed: ${redacted(output)}`,
				[evidence],
			);
}

async function checkVoicevox(): Promise<PreflightCheck> {
	const voicevox = getByosanProductionConfig().providers.tts.voicevox;
	const url = voicevox.url.replace(/\/$/, "");
	try {
		const response = await fetch(`${url}/version`, {
			signal: AbortSignal.timeout(voicevox.health_timeout_ms),
		});
		return response.ok
			? check("voicevox", "GET /version", "PASS", "VOICEVOX responded")
			: check(
					"voicevox",
					"GET /version",
					"FAIL",
					`VOICEVOX returned HTTP ${response.status}`,
				);
	} catch (error) {
		return check(
			"voicevox",
			"GET /version",
			"FAIL",
			`VOICEVOX is unavailable: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function runByosanPreflight(
	runDir: string,
	dependencies: ByosanPreflightDependencies = {},
): Promise<ByosanPreflightReport> {
	const commandCheck = dependencies.commandAvailable ?? commandAvailable;
	const nodeCheck = dependencies.nodeDependencies ?? checkNodeDependencies;
	const pythonCheck = dependencies.pythonRuntime ?? runPythonRuntime;
	const voicevoxCheck = dependencies.voicevox ?? checkVoicevox;
	const checks: Record<string, PreflightCheck> = {
		ffmpeg: commandCheck("ffmpeg"),
		ffprobe: commandCheck("ffprobe"),
		node_dependencies: nodeCheck(),
		python_runtime: pythonCheck(runDir),
		voicevox: await voicevoxCheck(),
	};
	const report: ByosanPreflightReport = {
		schema_version: "byosan_production_preflight_v1",
		status: Object.values(checks).every((item) => item.status === "PASS")
			? "PASS"
			: "FAIL",
		profile: "byosan",
		run_id: path
			.relative(path.join(ROOT, "runs"), runDir)
			.replaceAll(path.sep, "/"),
		publication_attempted: false,
		generated_at: new Date().toISOString(),
		checks,
	};
	fs.outputJsonSync(path.join(runDir, "audit", "preflight.json"), report, {
		spaces: 2,
	});
	return report;
}

if (import.meta.main) {
	const runDir = path.resolve(
		process.argv[2] ?? path.join(ROOT, "runs", "byosan_money", "preflight"),
	);
	runByosanPreflight(runDir)
		.then((report) => {
			console.log(JSON.stringify(report));
			if (report.status !== "PASS") process.exitCode = 1;
		})
		.catch((error) => {
			console.error(
				error instanceof Error ? (error.stack ?? error.message) : error,
			);
			process.exitCode = 1;
		});
}
