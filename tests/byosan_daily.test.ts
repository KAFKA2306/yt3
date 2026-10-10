import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	type ByosanFailureTrace,
	assertByosanRetryAllowed,
	findPublishedByosanRunForDate,
	preflightBlockedMessage,
	recordByosanFailure,
} from "../src/scripts/byosan_daily.js";

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
});

async function makeRoot(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "byosan-daily-test-"));
	tempRoots.push(root);
	return root;
}

async function makeRunDir(): Promise<string> {
	const root = await makeRoot();
	const runDir = path.join(root, "runs/byosan_money/2026-08-02-daily");
	await fs.ensureDir(path.join(runDir, "audit"));
	return runDir;
}

describe("byosan daily duplicate-publication gate", () => {
	test("returns null when the date has no upload receipt", async () => {
		const root = await makeRoot();
		expect(findPublishedByosanRunForDate(root, "2026-08-02")).toBeNull();
	});

	test("blocks duplicate upload when receipt exists but attestations are incomplete", async () => {
		const root = await makeRoot();
		const publishDir = path.join(
			root,
			"runs/byosan_money/2026-08-02-daily/publish",
		);
		await fs.outputJson(path.join(publishDir, "receipt.json"), {
			youtube: {
				status: "uploaded",
				video_id: "video123",
				channel_id: "UCYtjO-PYBfdG3MuPLXfhA-Q",
				privacy_status: "public",
			},
		});
		const result = findPublishedByosanRunForDate(root, "2026-08-02");
		expect(result?.verified).toBe(false);
		expect(result?.reason).toContain("attestation_is_incomplete");
	});

	test("accepts one verified public upload and suppresses another", async () => {
		const root = await makeRoot();
		const publishDir = path.join(
			root,
			"runs/byosan_money/2026-08-02-daily/publish",
		);
		await Promise.all([
			fs.outputJson(path.join(publishDir, "receipt.json"), {
				youtube: {
					status: "uploaded",
					video_id: "video123",
					channel_id: "UCYtjO-PYBfdG3MuPLXfhA-Q",
					privacy_status: "public",
				},
			}),
			fs.outputJson(path.join(publishDir, "visibility_attestation.json"), {
				current_privacy_status: "public",
				channel_id: "UCYtjO-PYBfdG3MuPLXfhA-Q",
			}),
			fs.outputJson(path.join(publishDir, "thumbnail_attestation.json"), {
				api_update_status: "succeeded",
			}),
		]);
		const result = findPublishedByosanRunForDate(root, "2026-08-02");
		expect(result).toMatchObject({
			runId: "byosan_money/2026-08-02-daily",
			verified: true,
			videoId: "video123",
		});
	});
});

describe("byosan failure retry gate", () => {
	test("carries the failing preflight check reason so the failure is classifiable", async () => {
		const runDir = await makeRunDir();
		const message = preflightBlockedMessage(
			{
				schema_version: "byosan_production_preflight_v1",
				status: "FAIL",
				profile: "byosan",
				run_id: "byosan_money/2026-10-10-daily",
				publication_attempted: false,
				generated_at: "2026-10-10T06:00:44.331Z",
				checks: {
					ffmpeg: {
						status: "PASS",
						component: "ffmpeg",
						method: "ffmpeg -version",
						reason: "command is available",
						evidence: [],
					},
					gemini: {
						status: "FAIL",
						component: "gemini",
						method: "configuration + structured-output probe",
						reason: "429 Too Many Requests: quota exhausted",
						evidence: [],
					},
				},
			},
			"audit/preflight.json",
		);
		expect(message).toContain(
			"gemini FAIL: 429 Too Many Requests: quota exhausted",
		);
		expect(message).not.toContain("ffmpeg FAIL");
		const trace = recordByosanFailure(runDir, new Error(message), "head-a");
		expect(trace.failure_class).toBe("PROVIDER_RATE_LIMIT");
		expect(trace.retry_policy).toBe("TRANSIENT_BOUNDED");
	});

	test("classifies a Zod invalid_type issue from provider output as PROVIDER_SCHEMA", async () => {
		const runDir = await makeRunDir();
		const trace = recordByosanFailure(
			runDir,
			new Error(
				'[{"expected":"array","code":"invalid_type","path":["candidate","adversarialEvidence"],"message":"Invalid input: expected array, received undefined"}]',
			),
			"head-a",
		);
		expect(trace).toMatchObject({
			failure_class: "PROVIDER_SCHEMA",
			retry_policy: "REQUIRES_REPAIR_EVIDENCE",
		});
	});

	test("does not classify a path containing 'youtuber' as a YouTube publish failure", async () => {
		const runDir = await makeRunDir();
		const trace = recordByosanFailure(
			runDir,
			new Error(
				"BYOSAN_PREFLIGHT_BLOCKED: FAIL /home/kafka/2511youtuber/v3/yt3/runs/byosan_money/2026-10-10-daily/audit/preflight.json",
			),
			"head-a",
		);
		expect(trace.failure_class).not.toBe("PUBLISH_REMOTE");
	});

	test("still classifies a real YouTube publish error as PUBLISH_REMOTE", async () => {
		const runDir = await makeRunDir();
		const trace = recordByosanFailure(
			runDir,
			new Error("YouTube upload rejected by channel quota"),
			"head-a",
		);
		expect(trace.failure_class).toBe("PUBLISH_REMOTE");
	});

	test("records a typed non-transient failure and blocks blind retry", async () => {
		const runDir = await makeRunDir();
		const trace = recordByosanFailure(
			runDir,
			new Error(
				"BYOSAN_FEATURE_GENERATION_FAILED: domain audit rejected draft",
			),
			"failed-head",
		);
		expect(trace).toMatchObject({
			status: "OPEN",
			failure_class: "SPEC_CONTRACT",
			stage: "SPEC",
			retry_policy: "REQUIRES_REPAIR_EVIDENCE",
			root_cause: "pending_trace_review",
			regression_test: "pending",
		});
		expect(() => assertByosanRetryAllowed(runDir, "failed-head")).toThrow(
			"RETRY_BLOCKED_REPAIR_EVIDENCE_REQUIRED",
		);
	});

	test("permits only the configured bounded retries for a provider rate limit", async () => {
		const runDir = await makeRunDir();
		recordByosanFailure(
			runDir,
			new Error("429 rate limit quota exhausted"),
			"head-a",
		);
		expect(() => assertByosanRetryAllowed(runDir, "head-a")).not.toThrow();
		recordByosanFailure(
			runDir,
			new Error("429 rate limit quota exhausted"),
			"head-a",
		);
		expect(() => assertByosanRetryAllowed(runDir, "head-a")).not.toThrow();
		recordByosanFailure(
			runDir,
			new Error("429 rate limit quota exhausted"),
			"head-a",
		);
		expect(() => assertByosanRetryAllowed(runDir, "head-a")).toThrow(
			"RETRY_BLOCKED_TRANSIENT_EXHAUSTED",
		);
	});

	test("never retries an uncertain publish command without remote read-back", async () => {
		const runDir = await makeRunDir();
		const trace = recordByosanFailure(
			runDir,
			new Error(
				"COMMAND_FAILED: bun src/scripts/publish_youtube.ts byosan_money/2026-08-02-daily status=1",
			),
			"head-a",
		);
		expect(trace.failure_class).toBe("UNCERTAIN_REMOTE_COMMIT");
		expect(() => assertByosanRetryAllowed(runDir, "head-a")).toThrow(
			"RETRY_BLOCKED_REMOTE_READBACK_REQUIRED",
		);
	});

	test("allows a source failure only after explicit repair and canonical validation evidence", async () => {
		const runDir = await makeRunDir();
		const trace = recordByosanFailure(
			runDir,
			new Error(
				"BYOSAN_FEATURE_GENERATION_FAILED: deterministic contract mismatch",
			),
			"failed-head",
		);
		const resolved: ByosanFailureTrace = {
			...trace,
			resolution: {
				status: "VERIFIED",
				root_cause: "generator violated the deterministic feature contract",
				regression_test:
					"tests/byosan_daily.test.ts::source failure retry gate",
				repair_commit: "repair-head",
				validation: {
					command: "task check:merge",
					status: "PASS",
					checked_at: "2026-08-30T06:30:00.000Z",
				},
			},
		};
		await fs.outputJson(
			path.join(runDir, "audit/failure_trace.json"),
			resolved,
			{
				spaces: 2,
			},
		);
		expect(() => assertByosanRetryAllowed(runDir, "repair-head")).not.toThrow();
		expect(() => assertByosanRetryAllowed(runDir, "different-head")).toThrow(
			"RETRY_BLOCKED_REPAIR_EVIDENCE_REQUIRED",
		);
	});
});
