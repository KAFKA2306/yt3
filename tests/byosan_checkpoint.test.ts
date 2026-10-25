import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	type ByosanCheckpoint,
	currentByosanFingerprints,
	reconcileByosanCheckpoint,
	writeByosanCheckpoint,
} from "../src/domain/byosan/checkpoint.js";

const RUN_ID = "byosan_money/2026-09-24-daily";

function makeFixture(): { root: string; runDir: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "yt3-checkpoint-root-"));
	const runDir = path.join(root, "runs", "byosan_money", "2026-09-24-daily");
	for (const file of [
		"src/domain/byosan/feed_discovery.ts",
		"config/sources/byosan_discovery_sources.json",
		"src/domain/byosan/feature_spec.ts",
		"src/scripts/byosan_daily.ts",
		"src/scripts/produce_byosan_feature.ts",
		"src/scripts/publish_youtube.ts",
		"src/domain/publication_state.ts",
	]) {
		fs.outputFileSync(path.join(root, file), file);
	}
	fs.outputFileSync(
		path.join(root, "config/domains/byosan_money.yaml"),
		"discovery: {recent_days: 7}\nllm:\n  backends: {feature: gemini}\n",
	);
	fs.outputFileSync(
		path.join(runDir, "research", "discovery_articles.json"),
		"[]",
	);
	return { root, runDir };
}

function readyCheckpoint(
	root: string,
	runDir: string,
	fingerprints = currentByosanFingerprints(root, runDir),
): ByosanCheckpoint {
	return {
		schema_version: "byosan_checkpoint_v1" as const,
		run_id: RUN_ID,
		fingerprints,
		stages: {
			research_ready: true,
			spec_ready: true,
			media_ready: true,
			quality_pass: true,
			publish_verified: true,
		},
		updated_at: new Date().toISOString(),
	} as ByosanCheckpoint;
}

describe("Byosan checkpoint research fingerprint", () => {
	test("changes when the discovery config or discovered articles change", () => {
		const { root, runDir } = makeFixture();
		const before = currentByosanFingerprints(root, runDir).research;
		fs.outputFileSync(
			path.join(root, "config/domains/byosan_money.yaml"),
			"discovery: {recent_days: 8}\n",
		);
		const configChanged = currentByosanFingerprints(root, runDir).research;
		expect(configChanged).not.toBe(before);
		fs.outputFileSync(
			path.join(runDir, "research", "discovery_articles.json"),
			'[{"title":"new"}]',
		);
		expect(currentByosanFingerprints(root, runDir).research).not.toBe(
			configChanged,
		);
	});

	test("invalidates only downstream stages when the media source changes", () => {
		const { root, runDir } = makeFixture();
		const checkpoint = readyCheckpoint(root, runDir);
		writeByosanCheckpoint(runDir, checkpoint);
		fs.appendFileSync(
			path.join(root, "src/scripts/produce_byosan_feature.ts"),
			"changed",
		);
		const reconciled = reconcileByosanCheckpoint(runDir, RUN_ID, root);
		expect(reconciled.stages.research_ready).toBe(true);
		expect(reconciled.stages.spec_ready).toBe(true);
		expect(reconciled.stages.media_ready).toBe(false);
		expect(reconciled.stages.quality_pass).toBe(false);
		expect(reconciled.stages.publish_verified).toBe(false);
	});

	test("resets every stage when a research input changes", () => {
		const { root, runDir } = makeFixture();
		writeByosanCheckpoint(runDir, readyCheckpoint(root, runDir));
		fs.outputFileSync(
			path.join(runDir, "research", "discovery_articles.json"),
			'[{"title":"new"}]',
		);
		const reconciled = reconcileByosanCheckpoint(runDir, RUN_ID, root);
		expect(reconciled.stages.research_ready).toBe(false);
		expect(reconciled.stages.spec_ready).toBe(false);
	});

	test("does not restore readiness when a research input changed since the artifact", () => {
		const { root, runDir } = makeFixture();
		fs.outputFileSync(path.join(runDir, "source", "feature_spec.json"), "{}");
		writeByosanCheckpoint(runDir, {
			...readyCheckpoint(root, runDir),
			fingerprints: {
				...currentByosanFingerprints(root, runDir),
				research: "inputs_v3:stale",
			},
			stages: {
				research_ready: false,
				spec_ready: false,
				media_ready: false,
				quality_pass: false,
				publish_verified: false,
			},
		});
		const reconciled = reconcileByosanCheckpoint(runDir, RUN_ID, root);
		expect(reconciled.stages.research_ready).toBe(false);
		expect(reconciled.stages.spec_ready).toBe(false);
	});

	test("does not restore a legacy checkpoint that has no discovery articles", () => {
		const { root, runDir } = makeFixture();
		fs.removeSync(path.join(runDir, "research", "discovery_articles.json"));
		const legacy = {
			...readyCheckpoint(root, runDir),
			fingerprints: {
				...currentByosanFingerprints(root, runDir),
				research: "legacy-whole-file-hash",
			},
		};
		writeByosanCheckpoint(runDir, legacy);
		const reconciled = reconcileByosanCheckpoint(runDir, RUN_ID, root);
		expect(reconciled.stages.research_ready).toBe(false);
		expect(reconciled.stages.spec_ready).toBe(false);
	});
});
