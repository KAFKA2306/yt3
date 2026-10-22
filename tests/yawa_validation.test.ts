import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { sha256File } from "../src/domain/publication_state.js";
import { validateYawaRun } from "../src/domain/yawa_validation.js";

const TITLE = "夜話アーカイブ ASMR";

function fixture(
	overrides: { privacy?: string; phase?: string; audit?: string } = {},
) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yawa-val-"));
	fs.writeFileSync(path.join(dir, "video.mp4"), "video-bytes");
	const sha = sha256File(path.join(dir, "video.mp4"));
	fs.ensureDirSync(path.join(dir, "audit"));
	fs.ensureDirSync(path.join(dir, "publish"));
	fs.writeJsonSync(path.join(dir, "audit", "result.json"), {
		tts_provenance: { status: overrides.audit ?? "PASS" },
	});
	fs.writeJsonSync(path.join(dir, "publish", "state.json"), {
		phase: overrides.phase ?? "VERIFIED",
		artifact_sha256: sha,
		video_id: "vid1",
	});
	fs.writeJsonSync(path.join(dir, "publish", "receipt.json"), {
		youtube: {
			video_id: "vid1",
			channel_title: TITLE,
			privacy_status: overrides.privacy ?? "public",
		},
	});
	return dir;
}

describe("yawa run validation", () => {
	test("passes a fully published run", () => {
		const result = validateYawaRun(fixture(), TITLE);
		expect(result.status).toBe("PASS");
		expect(result.run_id).toMatch(/^yawa_archive\//);
	});
	test("fails when privacy is not public", () => {
		const result = validateYawaRun(fixture({ privacy: "private" }), TITLE);
		expect(result.status).toBe("FAIL");
		expect(result.failures.join(" ")).toContain("privacy");
	});
	test("fails when publish phase is not VERIFIED", () => {
		const result = validateYawaRun(
			fixture({ phase: "PRIVATE_UPLOADED" }),
			TITLE,
		);
		expect(result.failures.join(" ")).toContain("expected VERIFIED");
	});
	test("fails when an audit check is not PASS", () => {
		const result = validateYawaRun(fixture({ audit: "QUALITY_FAIL" }), TITLE);
		expect(result.failures.join(" ")).toContain("audit not PASS");
	});
	test("fails when the channel differs", () => {
		const result = validateYawaRun(fixture(), "別のチャンネル");
		expect(result.failures.join(" ")).toContain("channel is");
	});
});
