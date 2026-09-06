import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { ByosanActiveProbeEvidenceSchema } from "../domain/byosan/active_probe.js";

const ROOT = process.cwd();

const StepStatusSchema = z.enum(["PASS", "FAIL", "UNVERIFIED"]);

const RuntimeStepSchema = z.object({
	status: StepStatusSchema,
	details: z.string().min(1),
	evidence: z.array(z.string()).default([]),
});

const RuntimeReportSchema = z.object({
	schemaVersion: z.literal("byosan_runtime_evidence_v1"),
	mode: z.enum(["smoke", "full"]),
	status: StepStatusSchema,
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
	period: z.enum(["week", "month"]).optional(),
	publishAttempted: z.literal(false),
	steps: z.record(z.string(), RuntimeStepSchema),
	generatedAt: z.string().datetime(),
});

type RuntimeStep = z.infer<typeof RuntimeStepSchema>;

function commandExists(command: string): boolean {
	const result = spawnSync(command, ["--version"], {
		cwd: ROOT,
		stdio: "ignore",
	});
	return result.status === 0;
}

function runCommand(
	command: string,
	args: string[],
	env: NodeJS.ProcessEnv = process.env,
): { status: number | null; stdout: string; stderr: string } {
	const result = spawnSync(command, args, {
		cwd: ROOT,
		env,
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
	});
	return {
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function writeReport(
	reportPath: string,
	params: {
		mode: "smoke" | "full";
		date?: string;
		period?: "week" | "month";
		steps: Record<string, RuntimeStep>;
	},
): void {
	const requiredSteps =
		params.mode === "smoke"
			? ["active_probe_runtime"]
			: [
					"preflight",
					"active_probe_runtime",
					"daily_prepare",
					"daily_release_gate",
					"digest_build",
					"digest_release_gate",
				];
	const requiredStatuses = requiredSteps.map(
		(step) => params.steps[step]?.status ?? "UNVERIFIED",
	);
	const status = requiredStatuses.includes("FAIL")
		? "FAIL"
		: requiredStatuses.includes("UNVERIFIED")
			? "UNVERIFIED"
			: "PASS";
	const report = RuntimeReportSchema.parse({
		schemaVersion: "byosan_runtime_evidence_v1",
		mode: params.mode,
		status,
		...(params.date ? { date: params.date } : {}),
		...(params.period ? { period: params.period } : {}),
		publishAttempted: false,
		steps: params.steps,
		generatedAt: new Date().toISOString(),
	});
	fs.outputJsonSync(reportPath, report, { spaces: 2 });
}

function appendStep(
	reportPath: string,
	params: {
		mode: "smoke" | "full";
		date?: string;
		period?: "week" | "month";
		steps: Record<string, RuntimeStep>;
	},
	key: string,
	step: RuntimeStep,
): void {
	params.steps[key] = RuntimeStepSchema.parse(step);
	writeReport(reportPath, params);
}

function safeDetail(stdout: string, stderr: string): string {
	const text = `${stdout}\n${stderr}`
		.replaceAll(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
		.replaceAll(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_KEY]")
		.trim();
	return text ? text.slice(-3000) : "command completed without output";
}

function runActiveProbe(
	workDir: string,
): RuntimeStep {
	const requestPath = path.join(workDir, "active_probe_request.json");
	const outputPath = path.join(workDir, "active_probe_evidence.json");
	fs.outputJsonSync(
		requestPath,
		{
			schemaVersion: "byosan_probe_request_v1",
			id: "runtime_git_diff",
			probeType: "git_diff",
			repoPath: ROOT,
			baseRef: "HEAD~1",
			headRef: "HEAD",
			sourceIds: ["yt3_repository"],
			limitations: [
				"Repository history observation only; this probe does not establish causal or identity claims.",
			],
			paid: false,
		},
		{ spaces: 2 },
	);
	const result = runCommand(
		process.execPath,
		["src/scripts/run_byosan_probe.ts", requestPath],
		{
			...process.env,
			SPEC: requestPath,
			OUT: outputPath,
		},
	);
	if (result.status !== 0) {
		return {
			status: "FAIL",
			details: safeDetail(result.stdout, result.stderr),
			evidence: [requestPath],
		};
	}
	if (!fs.existsSync(outputPath)) {
		return {
			status: "FAIL",
			details: "Active Probe command exited successfully but produced no evidence file.",
			evidence: [requestPath],
		};
	}
	const evidence = ByosanActiveProbeEvidenceSchema.parse(
		fs.readJsonSync(outputPath),
	);
	if (evidence.status !== "VERIFIED") {
		return {
			status: "FAIL",
			details: `Active Probe evidence status was ${evidence.status}.`,
			evidence: [requestPath, outputPath],
		};
	}
	return {
		status: "PASS",
		details:
			"Executed the canonical git-diff Active Probe against the current repository checkout and validated persisted evidence.",
		evidence: [requestPath, outputPath],
	};
}

async function preflightFullRuntime(): Promise<RuntimeStep> {
	const missing: string[] = [];
	for (const command of ["git", "ffmpeg", "ffprobe"]) {
		if (!commandExists(command)) missing.push(command);
	}
	const envPath = path.join(ROOT, "config", ".env.byosan");
	if (!fs.existsSync(envPath)) missing.push("config/.env.byosan");
	let voicevox = false;
	try {
		const url = process.env.VOICEVOX_URL ?? "http://localhost:50121";
		const response = await fetch(`${url.replace(/\/$/, "")}/version`, {
			signal: AbortSignal.timeout(5000),
		});
		voicevox = response.ok;
	} catch {
		voicevox = false;
	}
	if (!voicevox) missing.push("VOICEVOX runtime");
	if (missing.length > 0) {
		return {
			status: "UNVERIFIED",
			details: `Full runtime dependencies unavailable: ${missing.join(", ")}`,
			evidence: [],
		};
	}
	return {
		status: "PASS",
		details: "git, ffmpeg, ffprobe, Byosan env, and VOICEVOX are available.",
		evidence: [envPath],
	};
}

function runBunStep(
	args: string[],
	env: NodeJS.ProcessEnv,
	successDetail: string,
	evidence: string[],
): RuntimeStep {
	const result = runCommand(process.execPath, args, env);
	if (result.status !== 0) {
		return {
			status: "FAIL",
			details: safeDetail(result.stdout, result.stderr),
			evidence,
		};
	}
	return {
		status: "PASS",
		details: successDetail,
		evidence,
	};
}

async function main(): Promise<void> {
	const mode =
		process.env.BYOSAN_RUNTIME_MODE === "full" ? "full" : "smoke";
	const date = process.env.BYOSAN_DATE?.trim();
	const period =
		process.env.PERIOD === "month"
			? "month"
			: process.env.PERIOD === "week"
				? "week"
				: undefined;
	if (mode === "full") {
		if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
			throw new Error("BYOSAN_DATE=YYYY-MM-DD is required for full runtime verification");
		}
		if (!period) {
			throw new Error("PERIOD=week|month is required for full runtime verification");
		}
	}

	const workDir =
		mode === "smoke"
			? path.join(ROOT, ".artifacts", "byosan-runtime-smoke")
			: path.join(
					ROOT,
					"runs",
					"byosan_money",
					`${date}-runtime-verification`,
					"audit",
				);
	fs.ensureDirSync(workDir);
	const reportPath = path.join(workDir, "runtime_verification.json");
	const params: {
		mode: "smoke" | "full";
		date?: string;
		period?: "week" | "month";
		steps: Record<string, RuntimeStep>;
	} = {
		mode,
		...(date ? { date } : {}),
		...(period ? { period } : {}),
		steps: {},
	};

	appendStep(
		reportPath,
		params,
		"active_probe_runtime",
		runActiveProbe(workDir),
	);

	if (mode === "smoke") {
		writeReport(reportPath, params);
		const report = RuntimeReportSchema.parse(fs.readJsonSync(reportPath));
		if (report.status !== "PASS") {
			throw new Error(`BYOSAN_RUNTIME_SMOKE_FAILED: ${reportPath}`);
		}
		console.log(`BYOSAN_RUNTIME_SMOKE_PASS=${reportPath}`);
		return;
	}

	const preflight = await preflightFullRuntime();
	appendStep(reportPath, params, "preflight", preflight);
	if (preflight.status !== "PASS") {
		writeReport(reportPath, params);
		console.log(`BYOSAN_RUNTIME_UNVERIFIED=${reportPath}`);
		return;
	}

	const env = {
		...process.env,
		ENV_FILE: "config/.env.byosan",
		YOUTUBE_CHANNEL_PROFILE: "byosan",
		BYOSAN_DATE: date,
		BYOSAN_DAILY_NO_PUBLISH: "true",
	};

	const dailyRunId = `byosan_money/${date}-daily`;
	appendStep(
		reportPath,
		params,
		"daily_prepare",
		runBunStep(
			["--env-file=config/.env.byosan", "src/scripts/byosan_daily.ts"],
			env,
			`Prepared ${dailyRunId} without publishing.`,
			[path.join(ROOT, "runs", dailyRunId)],
		),
	);
	if (params.steps.daily_prepare?.status !== "PASS") {
		writeReport(reportPath, params);
		throw new Error(`BYOSAN_RUNTIME_DAILY_PREPARE_FAILED: ${reportPath}`);
	}

	appendStep(
		reportPath,
		params,
		"daily_release_gate",
		runBunStep(
			["src/scripts/check_product_release.ts", dailyRunId],
			{ ...env, RUN_ID: dailyRunId },
			`Release gate passed for ${dailyRunId}.`,
			[path.join(ROOT, "runs", dailyRunId, "audit")],
		),
	);
	if (params.steps.daily_release_gate?.status !== "PASS") {
		writeReport(reportPath, params);
		throw new Error(`BYOSAN_RUNTIME_DAILY_RELEASE_FAILED: ${reportPath}`);
	}

	const digestRunId =
		period === "week"
			? `byosan_money/${date}-weekly-digest`
			: `byosan_money/${date}-monthly-digest`;
	appendStep(
		reportPath,
		params,
		"digest_build",
		runBunStep(
			[
				"--env-file=config/.env.byosan",
				"src/scripts/build_byosan_digest.ts",
			],
			{ ...env, PERIOD: period, END: date },
			`Built ${digestRunId} with a separately audited digest bridge.`,
			[path.join(ROOT, "runs", digestRunId)],
		),
	);
	if (params.steps.digest_build?.status !== "PASS") {
		writeReport(reportPath, params);
		throw new Error(`BYOSAN_RUNTIME_DIGEST_BUILD_FAILED: ${reportPath}`);
	}

	appendStep(
		reportPath,
		params,
		"digest_release_gate",
		runBunStep(
			["src/scripts/check_product_release.ts", digestRunId],
			{ ...env, RUN_ID: digestRunId },
			`Release gate passed for ${digestRunId}.`,
			[path.join(ROOT, "runs", digestRunId, "audit")],
		),
	);

	if (process.env.WITH_ANALYTICS === "true") {
		appendStep(
			reportPath,
			params,
			"analytics_refresh",
			runBunStep(
				["src/scripts/refresh_youtube_analytics.ts"],
				env,
				"Authorized YouTube Analytics refresh completed.",
				[path.join(ROOT, "data", "memory", "byosan_money", "performance_summary.json")],
			),
		);
	} else {
		appendStep(reportPath, params, "analytics_refresh", {
			status: "UNVERIFIED",
			details:
				"Analytics refresh was not requested; set WITH_ANALYTICS=true to include the authorized OAuth path.",
			evidence: [],
		});
	}

	writeReport(reportPath, params);
	const report = RuntimeReportSchema.parse(fs.readJsonSync(reportPath));
	if (report.status !== "PASS") {
		throw new Error(`BYOSAN_RUNTIME_VERIFY_FAILED: ${reportPath}`);
	}
	console.log(`BYOSAN_RUNTIME_VERIFY_PASS=${reportPath}`);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
