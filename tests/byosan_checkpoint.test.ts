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

const CURRENT_STOP_DECISION = {
	decision: "STOP",
	selectedIndex: null,
	reason: "no candidate",
	candidateCount: 0,
	distinctPublisherCount: 0,
	orthogonality: {
		uniqueProfileCount: 0,
		geography: 0,
		sector: 0,
		actorType: 0,
		eventType: 0,
		timeHorizon: 0,
		causalDirection: 0,
		financialMetric: 0,
		supplyChainLayer: 0,
		marketRealEconomy: 0,
		dataSurface: 0,
		scale: 0,
		failedAxes: [],
	},
	evaluated: [],
};

function makeFixture(): { root: string; runDir: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "yt3-checkpoint-root-"));
	const runDir = path.join(root, "runs", "byosan_money", "2026-09-24-daily");
	for (const file of [
		"src/domain/agents/research.ts",
		"src/domain/byosan/news_angle.ts",
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
		"prompts:\n  research: {system: s1}\ndiscovery: {recent_days: 7}\nllm:\n  backends: {research: gemini}\n",
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
	test("ignores unrelated source and llm backend changes", () => {
		const { root, runDir } = makeFixture();
		const before = currentByosanFingerprints(root, runDir).research;
		fs.appendFileSync(path.join(root, "src/scripts/byosan_daily.ts"), "x");
		fs.outputFileSync(
			path.join(root, "config/domains/byosan_money.yaml"),
			"prompts:\n  research: {system: s1}\ndiscovery: {recent_days: 7}\nllm:\n  backends: {research: codex, feature: codex}\n",
		);
		expect(currentByosanFingerprints(root, runDir).research).toBe(before);
	});

	test("ignores daily flow edits that do not touch the research or spec inputs", () => {
		const { root, runDir } = makeFixture();
		const before = currentByosanFingerprints(root, runDir);
		fs.appendFileSync(path.join(root, "src/scripts/byosan_daily.ts"), "x");
		expect(currentByosanFingerprints(root, runDir)).toEqual(before);
	});

	test("changes when the research prompt, discovery config, or discovered articles change", () => {
		const { root, runDir } = makeFixture();
		const before = currentByosanFingerprints(root, runDir).research;
		fs.outputFileSync(
			path.join(root, "config/domains/byosan_money.yaml"),
			"prompts:\n  research: {system: s2}\ndiscovery: {recent_days: 7}\n",
		);
		const promptChanged = currentByosanFingerprints(root, runDir).research;
		expect(promptChanged).not.toBe(before);
		fs.outputFileSync(
			path.join(runDir, "research", "discovery_articles.json"),
			'[{"title":"new"}]',
		);
		expect(currentByosanFingerprints(root, runDir).research).not.toBe(
			promptChanged,
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

	test("migrates a legacy checkpoint by restoring research and spec readiness from current artifacts", () => {
		const { root, runDir } = makeFixture();
		fs.outputJsonSync(path.join(runDir, "source", "research_result.json"), {
			angle_decision: CURRENT_STOP_DECISION,
		});
		fs.outputFileSync(path.join(runDir, "source", "feature_spec.json"), "{}");
		const legacy = {
			...readyCheckpoint(root, runDir),
			fingerprints: {
				...currentByosanFingerprints(root, runDir),
				research: "legacy-whole-file-hash",
			},
			stages: {
				research_ready: false,
				spec_ready: false,
				media_ready: false,
				quality_pass: false,
				publish_verified: false,
			},
		};
		writeByosanCheckpoint(runDir, legacy);
		const reconciled = reconcileByosanCheckpoint(runDir, RUN_ID, root);
		expect(reconciled.stages.research_ready).toBe(true);
		expect(reconciled.stages.spec_ready).toBe(true);
		expect(reconciled.fingerprints.research).toStartWith("inputs_v2:");
	});

	test("restores readiness lost after an artifact was written, when inputs are unchanged", () => {
		const { root, runDir } = makeFixture();
		fs.outputJsonSync(path.join(runDir, "source", "research_result.json"), {
			angle_decision: CURRENT_STOP_DECISION,
		});
		fs.outputFileSync(path.join(runDir, "source", "feature_spec.json"), "{}");
		const checkpoint = {
			...readyCheckpoint(root, runDir),
			stages: {
				research_ready: false,
				spec_ready: false,
				media_ready: false,
				quality_pass: false,
				publish_verified: false,
			},
		};
		writeByosanCheckpoint(runDir, checkpoint);
		const reconciled = reconcileByosanCheckpoint(runDir, RUN_ID, root);
		expect(reconciled.stages.research_ready).toBe(true);
		expect(reconciled.stages.spec_ready).toBe(true);
	});

	test("does not restore readiness when a research input changed since the artifact", () => {
		const { root, runDir } = makeFixture();
		fs.outputJsonSync(path.join(runDir, "source", "research_result.json"), {
			angle_decision: CURRENT_STOP_DECISION,
		});
		fs.outputFileSync(path.join(runDir, "source", "feature_spec.json"), "{}");
		writeByosanCheckpoint(runDir, {
			...readyCheckpoint(root, runDir),
			fingerprints: {
				...currentByosanFingerprints(root, runDir),
				research: "inputs_v2:stale",
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

	test("does not restore a legacy research result whose angle decision is outdated", () => {
		const { root, runDir } = makeFixture();
		fs.outputJsonSync(path.join(runDir, "source", "research_result.json"), {
			angle_decision: { decision: "PASS", evaluated: [] },
		});
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
