import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { ROOT, loadConfig } from "../io/core.js";
import {
	REPAIR_VALIDATION_COMMAND,
	type RepairResolution,
	failureTracePath,
} from "./byosan_daily.js";

const ConfigSchema = z.object({
	workflow: z.object({
		default_bucket: z.string().min(1),
		paths: z.object({ runs_dir: z.string().min(1) }),
	}),
});

const FailureTraceSchema = z
	.object({
		schema_version: z.literal("byosan_failure_trace_v1"),
		status: z.enum(["OPEN", "RECOVERED"]),
	})
	.passthrough();

const EnvSchema = z.object({
	BYOSAN_DATE: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	ROOT_CAUSE: z.string().min(1),
	REGRESSION_TEST: z.string().min(1),
});

export function buildRepairResolution(input: {
	rootCause: string;
	regressionTest: string;
	repairCommit: string;
	checkExitStatus: number | null;
	checkedAt: string;
}): RepairResolution {
	if (input.checkExitStatus !== 0) {
		throw new Error(
			`REPAIR_VALIDATION_FAILED: ${REPAIR_VALIDATION_COMMAND} status=${input.checkExitStatus}`,
		);
	}
	if (!/^tests\/.+\.test\.ts$/.test(input.regressionTest)) {
		throw new Error(`REGRESSION_TEST_INVALID: ${input.regressionTest}`);
	}
	return {
		status: "VERIFIED",
		root_cause: input.rootCause,
		regression_test: input.regressionTest,
		repair_commit: input.repairCommit,
		validation: {
			command: REPAIR_VALIDATION_COMMAND,
			status: "PASS",
			checked_at: input.checkedAt,
		},
	};
}

function gitOutput(args: string[]): string {
	const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(
			`GIT_FAILED: git ${args.join(" ")} status=${result.status}`,
		);
	}
	return result.stdout.trim();
}

function main(): void {
	const env = EnvSchema.parse(process.env);
	const { workflow } = ConfigSchema.parse(loadConfig("byosan_money"));
	const runId = `${workflow.default_bucket}/${env.BYOSAN_DATE}-daily`;
	const runDir = path.join(ROOT, workflow.paths.runs_dir, runId);
	const tracePath = failureTracePath(runDir);
	const trace = FailureTraceSchema.parse(fs.readJsonSync(tracePath));
	if (trace.status !== "OPEN") {
		throw new Error(`TRACE_NOT_OPEN: ${runId} status=${trace.status}`);
	}
	if (!fs.existsSync(path.join(ROOT, env.REGRESSION_TEST))) {
		throw new Error(`REGRESSION_TEST_NOT_FOUND: ${env.REGRESSION_TEST}`);
	}
	if (gitOutput(["status", "--porcelain"]) !== "") {
		throw new Error("WORKTREE_DIRTY: commit the repair before recording it");
	}
	const repairCommit = gitOutput(["rev-parse", "HEAD"]);
	const check = spawnSync(REPAIR_VALIDATION_COMMAND, {
		cwd: ROOT,
		shell: true,
		stdio: "inherit",
	});
	const resolution = buildRepairResolution({
		rootCause: env.ROOT_CAUSE,
		regressionTest: env.REGRESSION_TEST,
		repairCommit,
		checkExitStatus: check.status,
		checkedAt: new Date().toISOString(),
	});
	fs.outputJsonSync(tracePath, { ...trace, resolution }, { spaces: 2 });
	console.log(`RESOLUTION_RECORDED=${runId} repair_commit=${repairCommit}`);
}

if (import.meta.main) main();
