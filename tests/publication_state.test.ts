import { describe, expect, test } from "bun:test";
import path from "node:path";
import fs from "fs-extra";
import {
	assertFactualIntegrityGate,
	assertNoLegacyPublishState,
	loadPublicationState,
	transitionPublication,
} from "../src/domain/publication_state.js";
import type { AgentState } from "../src/domain/types.js";

function tempRun(name: string): string {
	const dir = path.join(
		process.cwd(),
		".tmp-publication-tests",
		`${name}-${crypto.randomUUID()}`,
	);
	fs.ensureDirSync(dir);
	return dir;
}

describe("canonical publication state", () => {
	test("persists one canonical state and preserves remote identity", () => {
		const runDir = tempRun("state");
		try {
			const hash = "a".repeat(64);
			transitionPublication(runDir, {
				run_id: "byosan_money/test",
				artifact_sha256: hash,
				requested_visibility: "public",
				phase: "PRIVATE_UPLOAD_INTENT",
			});
			transitionPublication(runDir, {
				run_id: "byosan_money/test",
				artifact_sha256: hash,
				requested_visibility: "public",
				phase: "REMOTE_VERIFIED",
				video_id: "video-1",
				channel_id: "channel-1",
				channel_title: "Channel",
				observed_visibility: "private",
			});
			const state = loadPublicationState(runDir);
			expect(state?.phase).toBe("REMOTE_VERIFIED");
			expect(state?.video_id).toBe("video-1");
			expect(state?.artifact_sha256).toBe(hash);
		} finally {
			fs.removeSync(runDir);
		}
	});

	test("fails closed when legacy receipt exists without canonical state", () => {
		const runDir = tempRun("legacy");
		try {
			fs.ensureDirSync(path.join(runDir, "publish"));
			fs.writeJsonSync(path.join(runDir, "publish", "receipt.json"), {
				youtube: { video_id: "legacy-video" },
			});
			expect(() => assertNoLegacyPublishState(runDir)).toThrow(
				"Legacy publish evidence exists",
			);
		} finally {
			fs.removeSync(runDir);
		}
	});
});

describe("factual integrity publication gate", () => {
	test("accepts a canonical audit only when critical and provenance checks pass", () => {
		const runDir = tempRun("audit-pass");
		try {
			fs.ensureDirSync(path.join(runDir, "audit"));
			fs.writeJsonSync(path.join(runDir, "audit", "result.json"), {
				provenance: { status: "PASS", critical: true },
				script_integrity: { status: "PASS", critical: true },
			});
			const state = {
				run_id: "byosan_money/test",
				bucket: "byosan_money",
			} as AgentState;
			const evidence = assertFactualIntegrityGate(runDir, state);
			expect(fs.existsSync(evidence)).toBe(true);
			expect(fs.readJsonSync(evidence).passed).toBe(true);
		} finally {
			fs.removeSync(runDir);
		}
	});

	test("blocks public publication when a critical audit failed", () => {
		const runDir = tempRun("audit-fail");
		try {
			fs.ensureDirSync(path.join(runDir, "audit"));
			fs.writeJsonSync(path.join(runDir, "audit", "result.json"), {
				provenance: { status: "PASS", critical: true },
				script_integrity: { status: "FAIL", critical: true },
			});
			const state = {
				run_id: "byosan_money/test",
				bucket: "byosan_money",
			} as AgentState;
			expect(() => assertFactualIntegrityGate(runDir, state)).toThrow(
				"failed critical checks",
			);
		} finally {
			fs.removeSync(runDir);
		}
	});
});
