import { spawnSync } from "node:child_process";
import path from "node:path";
import * as dotenv from "dotenv";
import fs from "fs-extra";
import { z } from "zod";
import {
	type LlmBackend,
	byosanLlmConfig,
	codexLlmLogPath,
	invokeCodexStructured,
	llmBackend,
} from "../domain/byosan/codex_llm.js";
import { getByosanProductionConfig } from "../domain/byosan/production_config.js";
import {
	assertYouTubeChannelMatchesProfile,
	createYouTubeOAuthClient,
	loadYouTubeProfileEnv,
} from "../domain/youtube_profiles.js";
import { ROOT, invokeStructuredLlm, loadConfig } from "../io/core.js";

export type PreflightStatus = "PASS" | "FAIL" | "UNVERIFIED";

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
	gemini?: (runDir: string) => Promise<PreflightCheck>;
	codexLogin?: () => PreflightCheck;
	codexExec?: (runDir: string) => Promise<PreflightCheck>;
	llmBackends?: LlmBackend[];
	youtube?: () => Promise<PreflightCheck>;
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

export const ProbeSchema = z
	.object({ ok: z.boolean() })
	.refine((value) => value.ok, "ok must be true");

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

async function checkGemini(runDir: string): Promise<PreflightCheck> {
	const envPath = path.join(ROOT, "config", ".env.byosan");
	if (!fs.existsSync(envPath)) {
		return check(
			"gemini",
			"configuration + structured-output probe",
			"UNVERIFIED",
			`profile env file is missing: ${envPath}`,
			[envPath],
		);
	}
	dotenv.config({ path: envPath, override: true });
	if (
		!Object.keys(process.env).some(
			(name) => /^GEMINI_API_KEY(?:_\d+)?$/.test(name) && process.env[name],
		)
	) {
		return check(
			"gemini",
			"configuration + structured-output probe",
			"UNVERIFIED",
			"no configured Gemini key is available",
			[envPath],
		);
	}
	try {
		await invokeStructuredLlm({
			schema: ProbeSchema,
			name: "byosan_production_preflight",
			llmOptions: { temperature: 0, sessionId: runDir },
			maxAttempts: 1,
			evidencePath: path.join(
				runDir,
				"audit",
				"preflight_gemini_attempts.json",
			),
			messages: () => [
				{ role: "system", content: 'Return exactly {"ok":true}.' },
				{ role: "user", content: "Confirm the structured-output contract." },
			],
		});
		return check(
			"gemini",
			"configuration + structured-output probe",
			"PASS",
			"Gemini structured-output contract passed",
			[path.join(runDir, "audit", "preflight_gemini_attempts.json")],
		);
	} catch (error) {
		return check(
			"gemini",
			"configuration + structured-output probe",
			"FAIL",
			`Gemini structured-output probe failed: ${redacted(error instanceof Error ? error.message : String(error))}`,
			[path.join(runDir, "audit", "preflight_gemini_attempts.json")],
		);
	}
}

function codexLoginStatus(): PreflightCheck {
	const result = spawnSync("codex", ["login", "status"], {
		cwd: ROOT,
		encoding: "utf8",
	});
	const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
	return result.status === 0
		? check(
				"codex_login",
				"codex login status",
				"PASS",
				"codex login is active",
			)
		: check(
				"codex_login",
				"codex login status",
				"FAIL",
				`codex login is unavailable: ${redacted(output)}`,
			);
}

async function checkCodexExec(runDir: string): Promise<PreflightCheck> {
	const evidence = path.join(runDir, "audit", "preflight_codex_attempts.json");
	try {
		await invokeCodexStructured({
			llm: byosanLlmConfig(),
			logPath: codexLlmLogPath(runDir),
			schema: ProbeSchema,
			name: "byosan_production_preflight",
			maxAttempts: 1,
			evidencePath: evidence,
			messages: () => [
				{ role: "system", content: 'Return exactly {"ok":true}.' },
				{ role: "user", content: "Confirm the structured-output contract." },
			],
		});
		return check(
			"codex_exec",
			"codex exec structured-output probe",
			"PASS",
			"codex exec structured-output contract passed",
			[evidence],
		);
	} catch (error) {
		return check(
			"codex_exec",
			"codex exec structured-output probe",
			"FAIL",
			`codex exec structured-output probe failed: ${redacted(error instanceof Error ? error.message : String(error))}`,
			[evidence],
		);
	}
}

async function checkYouTube(): Promise<PreflightCheck> {
	try {
		const profile = loadYouTubeProfileEnv("byosan");
		const { auth } = await createYouTubeOAuthClient("byosan");
		await assertYouTubeChannelMatchesProfile(auth, profile);
		return check(
			"youtube",
			"read-only channels.list(mine=true)",
			"PASS",
			"authenticated channel matches the Byosan profile",
			[profile.tokenPath],
		);
	} catch (error) {
		return check(
			"youtube",
			"read-only channels.list(mine=true)",
			"UNVERIFIED",
			`read-only profile verification unavailable: ${redacted(error instanceof Error ? error.message : String(error))}`,
		);
	}
}

export function aggregateStatus(
	checks: Record<string, PreflightCheck>,
): PreflightStatus {
	const statuses = Object.values(checks).map((item) => item.status);
	if (statuses.includes("FAIL")) return "FAIL";
	if (statuses.includes("UNVERIFIED")) return "UNVERIFIED";
	return "PASS";
}

export async function runByosanPreflight(
	runDir: string,
	dependencies: ByosanPreflightDependencies = {},
): Promise<ByosanPreflightReport> {
	const commandCheck = dependencies.commandAvailable ?? commandAvailable;
	const nodeCheck = dependencies.nodeDependencies ?? checkNodeDependencies;
	const pythonCheck = dependencies.pythonRuntime ?? runPythonRuntime;
	const voicevoxCheck = dependencies.voicevox ?? checkVoicevox;
	const geminiCheck = dependencies.gemini ?? checkGemini;
	const loginCheck = dependencies.codexLogin ?? codexLoginStatus;
	const execCheck = dependencies.codexExec ?? checkCodexExec;
	const youtubeCheck = dependencies.youtube ?? checkYouTube;
	const backends = new Set<LlmBackend>(
		dependencies.llmBackends ?? Object.values(byosanLlmConfig().backends),
	);
	const checks: Record<string, PreflightCheck> = {
		ffmpeg: commandCheck("ffmpeg"),
		ffprobe: commandCheck("ffprobe"),
		node_dependencies: nodeCheck(),
		python_runtime: pythonCheck(runDir),
		voicevox: await voicevoxCheck(),
		youtube: await youtubeCheck(),
	};
	if (backends.has("gemini")) checks.gemini = await geminiCheck(runDir);
	if (backends.has("codex")) {
		checks.codex_login = loginCheck();
		checks.codex_exec = await execCheck(runDir);
	}
	const report: ByosanPreflightReport = {
		schema_version: "byosan_production_preflight_v1",
		status: aggregateStatus(checks),
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
