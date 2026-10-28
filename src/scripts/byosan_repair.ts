import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { ROOT, loadConfig } from "../io/core.js";

const RepairSchema = z.object({
	sandbox: z.enum(["read-only", "workspace-write"]),
	writable_paths: z.array(z.string().min(1)).min(1),
	acceptance: z.array(z.string().min(1)).min(1),
	prompt: z.string().min(1),
});

const ConfigSchema = z.object({
	workflow: z.object({
		default_bucket: z.string().min(1),
		paths: z.object({ runs_dir: z.string().min(1) }),
	}),
	repair: RepairSchema,
});

const FailureTraceSchema = z.object({
	schema_version: z.literal("byosan_failure_trace_v1"),
	status: z.enum(["OPEN", "RECOVERED"]),
	failure_class: z.string().min(1),
	stage: z.string().min(1),
	fingerprint: z.string().min(1),
});

function main(): void {
	const date = z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.parse(process.env.BYOSAN_DATE);
	const { workflow, repair } = ConfigSchema.parse(loadConfig("byosan_money"));
	const runId = `${workflow.default_bucket}/${date}-daily${process.env.BYOSAN_SUFFIX ?? ""}`;
	const runDir = path.join(ROOT, workflow.paths.runs_dir, runId);
	if (!fs.existsSync(runDir)) throw new Error(`RUN_NOT_FOUND: ${runDir}`);

	const tracePath = path.join(runDir, "audit", "failure_trace.json");
	if (!fs.existsSync(tracePath)) {
		console.log(`NO_FAILURE=${runId}`);
		return;
	}
	const traceText = fs.readFileSync(tracePath, "utf8");
	const trace = FailureTraceSchema.parse(JSON.parse(traceText));
	if (trace.status !== "OPEN") {
		console.log(`NO_FAILURE=${runId}`);
		return;
	}

	const startedAt = new Date().toISOString();
	const prompt = [
		repair.prompt,
		"[FAILURE_TRACE]",
		traceText,
		"[WRITABLE_PATHS]",
		...repair.writable_paths.map((entry) => `- ${entry}`),
		"[ACCEPTANCE]",
		...repair.acceptance.map((command) => `- ${command}`),
	].join("\n");
	const result = spawnSync(
		"codex",
		[
			"exec",
			"--sandbox",
			repair.sandbox,
			"--ephemeral",
			"--ignore-user-config",
			"-",
		],
		{ cwd: ROOT, input: prompt, stdio: ["pipe", "inherit", "inherit"] },
	);

	const attemptPath = path.join(
		runDir,
		"audit",
		`repair_attempt_${startedAt.replace(/[:.]/g, "-")}.json`,
	);
	fs.outputJsonSync(
		attemptPath,
		{
			started_at: startedAt,
			failure_class: trace.failure_class,
			fingerprint: trace.fingerprint,
			codex_exit_code: result.status,
		},
		{ spaces: 2 },
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`REPAIR_CODEX_FAILED: exit ${result.status} ${attemptPath}`,
		);
	}
	console.log(`REPAIR_ATTEMPT=${attemptPath}`);
}

if (import.meta.main) main();
