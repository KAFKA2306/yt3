import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { runAudioQA } from "../src/io/utils/audio_qa.ts";
import {
	getMissingEvidence,
	isEvidenceReady,
} from "../src/io/utils/stability.ts";

describe("Stability and Audit Helpers", () => {
	test("isEvidenceReady requires the canonical proof chain", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "yt3-stability-"));
		try {
			const runDir = path.join(root, "runs", "byosan_money", "2026-07-10-test");
			await fs.ensureDir(runDir);

			expect(isEvidenceReady(runDir)).toBe(false);
			expect(getMissingEvidence(runDir)).toContain("run_evidence.json");

			const evidencePath = path.join(runDir, "run_evidence.json");
			await fs.writeFile(evidencePath, "invalid json");
			expect(isEvidenceReady(runDir)).toBe(false);
			expect(getMissingEvidence(runDir)[0]).toContain(
				"run_evidence.json (invalid JSON)",
			);

			const failedEvidence = {
				run_id: "byosan_money/2026-07-10-test",
				bucket: "byosan_money",
				status: "failed",
				disposition: "fatal",
				public_url: "https://www.youtube.com/watch?v=123",
			};
			await fs.writeJson(evidencePath, failedEvidence, { spaces: 2 });
			expect(isEvidenceReady(runDir)).toBe(false);
			let missing = getMissingEvidence(runDir);
			expect(missing).toContain("evidence disposition=fatal");

			const successEvidence = {
				run_id: "byosan_money/2026-07-10-test",
				bucket: "byosan_money",
				status: "success",
				disposition: "success",
				public_url: "https://www.youtube.com/watch?v=123",
			};
			await fs.writeJson(evidencePath, successEvidence, { spaces: 2 });
			expect(isEvidenceReady(runDir)).toBe(false);
			missing = getMissingEvidence(runDir);
			expect(missing).toContain("publish/receipt.json");
			expect(missing).toContain("publish/state.json");
			expect(missing).toContain("media/video/video.mp4");
			expect(missing).toContain("research.json");
			expect(missing).toContain("audit/report.json");

			await fs.writeJson(path.join(runDir, "research.json"), {});
			await fs.ensureDir(path.join(runDir, "media", "video"));
			await fs.writeFile(path.join(runDir, "media", "video", "video.mp4"), "");
			await fs.ensureDir(path.join(runDir, "publish"));
			await fs.writeJson(path.join(runDir, "publish", "receipt.json"), {
				youtube: { video_id: "123" },
			});
			await fs.writeJson(path.join(runDir, "publish", "state.json"), {
				phase: "VERIFIED",
				video_id: "123",
			});
			await fs.ensureDir(path.join(runDir, "audit"));
			await fs.writeJson(path.join(runDir, "audit", "report.json"), {
				decision: "PASS",
			});

			expect(isEvidenceReady(runDir)).toBe(true);
			expect(getMissingEvidence(runDir).length).toBe(0);
		} finally {
			await fs.remove(root);
		}
	});

	test("runAudioQA reports a missing file as an infrastructure failure", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "yt3-audio-qa-"));
		try {
			const result = runAudioQA("non_existent_video.mp4", root);
			expect(result.status).toBe("INFRA_FAIL");
			expect(result.details).toContain("Video file not found");
			expect(result.report.final_decision).toBe("FAIL");
		} finally {
			await fs.remove(root);
		}
	});
});
