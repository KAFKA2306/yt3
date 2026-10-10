import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	parsePublishJobFile,
	publishJobFingerprint,
	readUploadIntent,
	writeUploadIntent,
} from "../src/domain/publish_contract.js";

describe("publish contract", () => {
	test("normalizes captions shorthand and creates a stable fingerprint", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yt3-contract-"));
		const jobPath = path.join(dir, "job.yaml");
		await fs.writeFile(
			jobPath,
			[
				"schema_version: yt3.publish-job.v1",
				"job_id: test-job",
				"profile: byosan",
				"bucket: byosan_money",
				"run_id: test-run",
				"target_visibility: private",
				"thumbnail_required: false",
				"captions:",
				"  required: true",
				"  path: /tmp/test.vtt",
				"allow_publicize: false",
			].join("\n"),
		);

		const job = parsePublishJobFile(jobPath);
		expect(job.captions.required).toBe(true);
		expect(job.captions.language).toBe("ja");
		expect(publishJobFingerprint(job)).toMatch(/^[a-f0-9]{64}$/);
		expect(publishJobFingerprint(job)).toBe(publishJobFingerprint(job));
	});

	test("creates an intent once and refuses a second insert intent", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yt3-intent-"));
		const intent = {
			schema_version: "yt3.upload-intent.v1" as const,
			job_fingerprint: crypto.createHash("sha256").update("job").digest("hex"),
			job_id: "job",
			profile: "byosan" as const,
			run_id: "byosan_money/test-run",
			video_path: "/tmp/video.mp4",
			created_at: new Date().toISOString(),
			status: "insert_started" as const,
		};

		writeUploadIntent(dir, intent);
		expect(readUploadIntent(dir)?.job_id).toBe("job");
		expect(() => writeUploadIntent(dir, intent)).toThrow(
			"UNCERTAIN_REMOTE_COMMIT",
		);
	});
});
