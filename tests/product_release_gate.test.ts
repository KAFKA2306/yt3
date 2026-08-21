import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import { assertProductReleaseGate } from "../src/domain/product_release_gate.js";
import type { AgentState } from "../src/domain/types.js";
import { YOUTUBE_PROFILES } from "../src/domain/youtube_profiles.js";

function tempRun(name: string): string {
	const dir = path.join(
		process.cwd(),
		".tmp-product-release-tests",
		`${name}-${randomUUID()}`,
	);
	fs.ensureDirSync(dir);
	return dir;
}

function readyState(runDir: string): AgentState {
	const videoPath = path.join(runDir, "video.mp4");
	fs.writeFileSync(videoPath, "release-artifact");
	fs.ensureDirSync(path.join(runDir, "audit"));
	fs.writeJsonSync(path.join(runDir, "audit", "result.json"), {
		provenance: { status: "PASS", critical: true },
		script_integrity: { status: "PASS", critical: true },
	});
	return {
		run_id: "byosan_money/test",
		bucket: "byosan_money",
		video_path: videoPath,
		metadata: {
			title: "Release candidate",
			thumbnail_title: "Release candidate",
			description: "Verified description",
			tags: ["finance"],
		},
	};
}

describe("product release gate", () => {
	test("passes a concrete audited artifact and writes factual-integrity evidence", () => {
		const runDir = tempRun("pass");
		try {
			const result = assertProductReleaseGate({
				runDir,
				runId: "byosan_money/test",
				state: readyState(runDir),
				profile: YOUTUBE_PROFILES.byosan,
				requireFactualIntegrity: true,
			});
			expect(result.profile).toBe("byosan");
			expect(result.artifactSha256).toHaveLength(64);
			expect(result.factualIntegrityAttestation).toBeTruthy();
			expect(
				fs.existsSync(result.factualIntegrityAttestation || "missing"),
			).toBe(true);
		} finally {
			fs.removeSync(runDir);
		}
	});

	test("fails closed when the run bucket and release profile differ", () => {
		const runDir = tempRun("bucket");
		try {
			const state = readyState(runDir);
			state.bucket = "humanity_observatory";
			expect(() =>
				assertProductReleaseGate({
					runDir,
					runId: "byosan_money/test",
					state,
					profile: YOUTUBE_PROFILES.byosan,
					requireFactualIntegrity: true,
				}),
			).toThrow("does not match profile bucket");
		} finally {
			fs.removeSync(runDir);
		}
	});

	test("blocks fallback-labeled product metadata", () => {
		const runDir = tempRun("fallback");
		try {
			const state = readyState(runDir);
			if (!state.metadata) throw new Error("test metadata missing");
			state.metadata.description = "cached fallback output";
			expect(() =>
				assertProductReleaseGate({
					runDir,
					runId: "byosan_money/test",
					state,
					profile: YOUTUBE_PROFILES.byosan,
					requireFactualIntegrity: true,
				}),
			).toThrow("fallback metadata is prohibited");
		} finally {
			fs.removeSync(runDir);
		}
	});
});
