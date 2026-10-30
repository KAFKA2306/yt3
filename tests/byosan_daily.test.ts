import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	assertByosanRetryAllowed,
	findPublishedByosanRunForDate,
	generateFeatureSpec,
	recordByosanFailure,
} from "../src/scripts/byosan_daily.js";
import { fixtureDraft, fixtureInput } from "./fixtures/byosan_draft.js";

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
		expect(findPublishedByosanRunForDate(root, "2026-08-02-daily")).toBeNull();
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
		const result = findPublishedByosanRunForDate(root, "2026-08-02-daily");
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
		const result = findPublishedByosanRunForDate(root, "2026-08-02-daily");
		expect(result).toMatchObject({
			runId: "byosan_money/2026-08-02-daily",
			verified: true,
			videoId: "video123",
		});
	});
});

describe("byosan feature generation", () => {
	test("generates one validated draft without a panel review", async () => {
		const runDir = await makeRunDir();
		const prompts: string[] = [];
		const result = await generateFeatureSpec(
			fixtureInput(),
			runDir,
			(prompt) => {
				prompts.push(prompt);
				return JSON.stringify(fixtureDraft());
			},
		);
		expect(result.spec.segments.length).toBeGreaterThan(0);
		expect(prompts).toHaveLength(1);
		expect(await fs.pathExists(path.join(runDir, "audit", "panel.json"))).toBe(
			false,
		);
	});
});

describe("byosan failure retry limits", () => {
	test("classifies a Zod invalid_type issue from provider output as PIPELINE_FAILURE", async () => {
		const runDir = await makeRunDir();
		const trace = recordByosanFailure(
			runDir,
			new Error(
				'[{"expected":"array","code":"invalid_type","path":["candidate","adversarialEvidence"],"message":"Invalid input: expected array, received undefined"}]',
			),
			"head-a",
		);
		expect(trace.failure_class).toBe("PIPELINE_FAILURE");
	});

	test("does not classify a path containing 'youtuber' as a YouTube publish failure", async () => {
		const runDir = await makeRunDir();
		const trace = recordByosanFailure(
			runDir,
			new Error(
				"BYOSAN_FEATURE_DRAFT_INVALID: /home/kafka/2511youtuber/v3/yt3/runs/byosan_money/2026-10-10-daily/audit/feature.json",
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

	test("does not block a rerun after a pipeline failure", async () => {
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
			failure_class: "PIPELINE_FAILURE",
			stage: "SPEC",
		});
		expect(() => assertByosanRetryAllowed(runDir)).not.toThrow();
	});

	test("does not cap rate-limit retries; the same-day attempt cap bounds them", async () => {
		const runDir = await makeRunDir();
		for (let attempt = 0; attempt < 5; attempt++) {
			recordByosanFailure(
				runDir,
				new Error("429 rate limit quota exhausted"),
				"head-a",
			);
			expect(() => assertByosanRetryAllowed(runDir)).not.toThrow();
		}
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
		expect(() => assertByosanRetryAllowed(runDir)).toThrow(
			"RETRY_BLOCKED_REMOTE_READBACK_REQUIRED",
		);
	});

	test("classifies BYOSAN_ANGLE_STOP as RESEARCH_ANGLE_STOP at the research stage", async () => {
		const runDir = await makeRunDir();
		const trace = recordByosanFailure(
			runDir,
			new Error("BYOSAN_ANGLE_STOP: no passing angle decision"),
			"head-a",
		);
		expect(trace).toMatchObject({
			failure_class: "RESEARCH_ANGLE_STOP",
			stage: "RESEARCH",
		});
	});
});
