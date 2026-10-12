import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import {
	reconcileByosanCheckpoint,
	writeByosanCheckpoint,
} from "../domain/byosan/checkpoint.js";
import { ROOT, loadConfig } from "../io/core.js";
import { findPublishedByosanRunForDate } from "./byosan_daily.js";

const DOMAIN_ID = "byosan_money";
const PROFILE = "byosan";
const MAX_TASK_OUTPUT_BYTES = 1024 * 1024 * 512;

export type TaskResult = { status: number; output: string };
export type TaskRunner = (args: string[]) => TaskResult;

export type GateEvidence = {
	runId: string;
	artifactSha256: string;
	publishCommand: string;
};

const ReadyRecordSchema = z.object({
	run_id: z.string(),
	status: z.enum(["GATE_FAILED", "READY", "PUBLISH_ATTEMPTED", "PUBLISHED"]),
	reason: z.string().optional(),
	artifact_sha256: z.string().optional(),
	publish_command: z.string().optional(),
	recorded_at: z.string(),
});
export type ReadyRecord = z.infer<typeof ReadyRecordSchema>;

export type PublishDailyDeps = {
	root: string;
	now: Date;
	timezone: string;
	resumeDate: string;
	publishApproved: boolean;
	runTask: TaskRunner;
};

export function tokyoDate(now: Date, timezone: string): string {
	return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}

function publishArgs(runId: string): string[] {
	return ["publish", `PROFILE=${PROFILE}`, "--", runId];
}

export function parseGateEvidence(
	output: string,
	runId: string,
): GateEvidence | null {
	const gate = output.match(
		/^\[product-release-gate\] PASS profile=(\S+) run=(\S+) artifact_sha256=([0-9a-f]{64})$/m,
	);
	const readyRun = output.match(/^PUBLISH_READY_RUN=(\S+)$/m);
	const publishCommand = output.match(/^PUBLISH_COMMAND=(.+)$/m);
	if (!gate || !readyRun || !publishCommand) return null;
	const [, profile, gateRunId, artifactSha256] = gate;
	const expectedCommand = `task ${publishArgs(runId).join(" ")}`;
	if (
		profile !== PROFILE ||
		gateRunId !== runId ||
		artifactSha256 === undefined ||
		readyRun[1] !== runId ||
		publishCommand[1] !== expectedCommand
	) {
		return null;
	}
	return {
		runId,
		artifactSha256,
		publishCommand: expectedCommand,
	};
}

function recordFile(root: string, runId: string): string {
	return path.join(root, "runs", runId, "publish", "ready.json");
}

function writeRecord(file: string, record: ReadyRecord): void {
	fs.outputJsonSync(file, record, { spaces: 2 });
}

function prepareGate(
	deps: PublishDailyDeps,
	date: string,
	runId: string,
	file: string,
): ReadyRecord {
	const prepared = deps.runTask(["byosan:prepare", `DATE=${date}`]);
	const evidence =
		prepared.status === 0 ? parseGateEvidence(prepared.output, runId) : null;
	const recordedAt = deps.now.toISOString();
	if (!evidence) {
		const reason =
			prepared.status === 0
				? "gate_evidence_incomplete"
				: `prepare_status=${prepared.status}`;
		writeRecord(file, {
			run_id: runId,
			status: "GATE_FAILED",
			reason,
			recorded_at: recordedAt,
		});
		throw new Error(`PREPARE_GATE_FAILED: ${runId} ${reason}`);
	}
	const record: ReadyRecord = {
		run_id: runId,
		status: "READY",
		artifact_sha256: evidence.artifactSha256,
		publish_command: evidence.publishCommand,
		recorded_at: recordedAt,
	};
	writeRecord(file, record);
	return record;
}

export function runByosanPublishDaily(deps: PublishDailyDeps): void {
	const date = tokyoDate(deps.now, deps.timezone);
	if (date < deps.resumeDate) {
		console.log(
			`BYOSAN_PUBLISH_SKIPPED_BEFORE_RESUME date=${date} resume_date=${deps.resumeDate}`,
		);
		return;
	}
	const runId = `${DOMAIN_ID}/${date}-daily`;
	const existing = findPublishedByosanRunForDate(deps.root, date);
	if (existing?.verified) {
		console.log(
			`ALREADY_PUBLISHED=${existing.runId} VIDEO_ID=${existing.videoId ?? "unknown"}`,
		);
		return;
	}
	if (existing) {
		throw new Error(
			`DUPLICATE_PUBLISH_BLOCKED: ${existing.runId} ${existing.reason}`,
		);
	}

	const file = recordFile(deps.root, runId);
	const record = fs.existsSync(file)
		? ReadyRecordSchema.parse(fs.readJsonSync(file))
		: prepareGate(deps, date, runId, file);
	if (record.status !== "READY") {
		throw new Error(
			`SAME_DATE_RETRY_BLOCKED: ${runId} status=${record.status} reason=${record.reason ?? "none"}`,
		);
	}
	if (!deps.publishApproved) {
		console.log(`PUBLISH_HELD run=${runId} publish_approved=false`);
		return;
	}

	writeRecord(file, {
		...record,
		status: "PUBLISH_ATTEMPTED",
		recorded_at: deps.now.toISOString(),
	});
	const published = deps.runTask(publishArgs(runId));
	if (published.status !== 0) {
		throw new Error(
			`PUBLISH_FAILED: ${runId} status=${published.status} record=PUBLISH_ATTEMPTED`,
		);
	}
	const evidence = findPublishedByosanRunForDate(deps.root, date);
	if (!evidence?.verified || evidence.runId !== runId) {
		throw new Error(
			`PUBLISH_EVIDENCE_INCOMPLETE: ${runId} ${evidence?.reason ?? "missing_receipt"}`,
		);
	}
	const runDir = path.join(deps.root, "runs", runId);
	const checkpoint = reconcileByosanCheckpoint(runDir, runId, deps.root);
	checkpoint.stages.publish_verified = true;
	writeByosanCheckpoint(runDir, checkpoint);
	writeRecord(file, {
		...record,
		status: "PUBLISHED",
		recorded_at: deps.now.toISOString(),
	});
	console.log(
		`BYOSAN_PUBLISH_PASS=${runId} VIDEO_ID=${evidence.videoId ?? "unknown"}`,
	);
}

const runTask: TaskRunner = (args) => {
	const result = spawnSync("task", args, {
		cwd: ROOT,
		env: process.env,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
		maxBuffer: MAX_TASK_OUTPUT_BYTES,
	});
	process.stdout.write(result.stdout);
	return { status: result.status ?? 1, output: result.stdout };
};

if (import.meta.main) {
	const policy = loadConfig(DOMAIN_ID).daily_publish;
	if (!policy) throw new Error(`DAILY_PUBLISH_POLICY_MISSING: ${DOMAIN_ID}`);
	runByosanPublishDaily({
		root: ROOT,
		now: new Date(),
		timezone: policy.timezone,
		resumeDate: policy.resume_date,
		publishApproved: policy.publish_approved,
		runTask,
	});
}
