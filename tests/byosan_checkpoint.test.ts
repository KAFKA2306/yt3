import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	currentByosanFingerprints,
	reconcileByosanCheckpoint,
	writeByosanCheckpoint,
} from "../src/domain/byosan/checkpoint.js";

describe("Byosan checkpoint invalidation", () => {
	test("invalidates only downstream stages when the media source changes", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "yt3-checkpoint-root-"));
		const runDir = path.join(root, "runs", "byosan_money", "2026-09-24-daily");
		for (const file of [
			"src/domain/agents/research.ts",
			"src/domain/byosan/news_angle.ts",
			"src/scripts/byosan_daily.ts",
			"src/domain/byosan/feature_spec.ts",
			"src/scripts/produce_byosan_feature.ts",
			"src/scripts/publish_youtube.ts",
			"src/domain/publication_state.ts",
		]) {
			fs.outputFileSync(path.join(root, file), file);
		}
		const checkpoint = {
			schema_version: "byosan_checkpoint_v1" as const,
			run_id: "byosan_money/2026-09-24-daily",
			fingerprints: currentByosanFingerprints(root),
			stages: {
				research_ready: true,
				spec_ready: true,
				media_ready: true,
				quality_pass: true,
				publish_verified: true,
			},
			updated_at: new Date().toISOString(),
		};
		writeByosanCheckpoint(runDir, checkpoint);
		fs.appendFileSync(
			path.join(root, "src/scripts/produce_byosan_feature.ts"),
			"changed",
		);
		const reconciled = reconcileByosanCheckpoint(
			runDir,
			checkpoint.run_id,
			root,
		);
		expect(reconciled.stages.research_ready).toBe(true);
		expect(reconciled.stages.spec_ready).toBe(true);
		expect(reconciled.stages.media_ready).toBe(false);
		expect(reconciled.stages.quality_pass).toBe(false);
		expect(reconciled.stages.publish_verified).toBe(false);
	});
});
