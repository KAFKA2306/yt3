import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	type ByosanFailureTrace,
	assertByosanRetryAllowed,
	findPublishedByosanRunForDate,
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
