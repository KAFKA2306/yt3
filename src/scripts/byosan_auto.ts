import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { ROOT, loadConfig } from "../io/core.js";
import {
	type GateEvidence,
	type TaskResult,
	type TaskRunner,
	parseGateEvidence,
} from "./byosan_publish_daily.js";

const DOMAIN_ID = "byosan_money";
const MAX_TASK_OUTPUT_BYTES = 1024 * 1024 * 512;

const ConfigSchema = z.object({
	workflow: z.object({
		default_bucket: z.string().min(1),
		paths: z.object({ runs_dir: z.string().min(1) }),
	}),
	auto: z.object({ max_prepare_attempts: z.number().int().min(1) }),
});

const FailureTraceSchema = z.object({
	schema_version: z.literal("byosan_failure_trace_v1"),
	status: z.enum(["OPEN", "RECOVERED"]),
	failure_class: z.string().min(1),
	stage: z.string().min(1),
	fingerprint: z.string().min(1),
});

const RepairAttemptSchema = z.object({
	started_at: z.string().min(1),
	failure_class: z.string().min(1),
	fingerprint: z.string().min(1),
	codex_exit_code: z.number().int().nullable(),
});

export type AutoAction =
	| { kind: "PUBLISH_READY"; evidence: GateEvidence }
	| { kind: "REPAIR" }
	| { kind: "EXHAUSTED" };

export function decideAfterPrepare(
	prepared: TaskResult,
	runId: string,
	prepareAttempt: number,
	maxPrepareAttempts: number,
): AutoAction {
	const evidence =
		prepared.status === 0 ? parseGateEvidence(prepared.output, runId) : null;
	if (evidence) return { kind: "PUBLISH_READY", evidence };
	if (prepareAttempt < maxPrepareAttempts) return { kind: "REPAIR" };
	return { kind: "EXHAUSTED" };
}

const runTask: TaskRunner = (args) => {
	const result = spawnSync("task", args, {
		cwd: ROOT,
		env: process.env,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
		maxBuffer: MAX_TASK_OUTPUT_BYTES,
	});
	if (result.error) throw result.error;
	process.stdout.write(result.stdout);
	return { status: result.status ?? 1, output: result.stdout };
};

function reportExhausted(runDir: string, runId: string): void {
	const auditDir = path.join(runDir, "audit");
	const tracePath = path.join(auditDir, "failure_trace.json");
	if (fs.existsSync(tracePath)) {
		const trace = FailureTraceSchema.parse(fs.readJsonSync(tracePath));
		console.log(
			`FAILURE_CLASS=${trace.failure_class} STAGE=${trace.stage} STATUS=${trace.status} FINGERPRINT=${trace.fingerprint}`,
		);
	} else {
		console.log(`FAILURE_TRACE_MISSING=${runId}`);
	}
	const attemptNames = fs.existsSync(auditDir)
		? fs
				.readdirSync(auditDir)
				.filter((name) => /^repair_attempt_.*\.json$/.test(name))
				.sort()
		: [];
	for (const name of attemptNames) {
		const attempt = RepairAttemptSchema.parse(
			fs.readJsonSync(path.join(auditDir, name)),
		);
		console.log(
			`REPAIR_ATTEMPT=${path.join(auditDir, name)} started_at=${attempt.started_at} failure_class=${attempt.failure_class} codex_exit_code=${attempt.codex_exit_code}`,
		);
	}
	if (attemptNames.length === 0) console.log(`REPAIR_ATTEMPTS=0 run=${runId}`);
}

function main(): void {
	const date = z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.parse(process.env.BYOSAN_DATE);
	const { workflow, auto } = ConfigSchema.parse(loadConfig(DOMAIN_ID));
	const runId = `${workflow.default_bucket}/${date}-daily${process.env.BYOSAN_SUFFIX ?? ""}`;
	const runDir = path.join(ROOT, workflow.paths.runs_dir, runId);

	for (let attempt = 1; ; attempt++) {
		const prepared = runTask(["byosan:prepare", `DATE=${date}`]);
		const action = decideAfterPrepare(
			prepared,
			runId,
			attempt,
			auto.max_prepare_attempts,
		);
		if (action.kind === "PUBLISH_READY") {
			console.log(
				`BYOSAN_AUTO_READY=${runId} prepare_attempts=${attempt} publish_executed=false`,
			);
			console.log(`PUBLISH_COMMAND=${action.evidence.publishCommand}`);
			return;
		}
		if (action.kind === "EXHAUSTED") {
			reportExhausted(runDir, runId);
			throw new Error(
				`BYOSAN_AUTO_EXHAUSTED: ${runId} prepare_attempts=${attempt} max_prepare_attempts=${auto.max_prepare_attempts}`,
			);
		}
		runTask(["byosan:repair", `DATE=${date}`]);
	}
}

if (import.meta.main) main();
