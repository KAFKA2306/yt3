import { createHash } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import { isCurrentByosanAngleDecision } from "./news_angle.js";

type ByosanCheckpointStages = {
	research_ready: boolean;
	spec_ready: boolean;
	media_ready: boolean;
	quality_pass: boolean;
	publish_verified: boolean;
};

export type ByosanCheckpoint = {
	schema_version: "byosan_checkpoint_v1";
	run_id: string;
	fingerprints: {
		research: string;
		spec: string;
		media: string;
		publish: string;
	};
	stages: ByosanCheckpointStages;
	updated_at: string;
};

const BYOSAN_CONFIG_RELATIVE_PATH = "config/domains/byosan_money.yaml";

const EMPTY_STAGES: ByosanCheckpointStages = {
	research_ready: false,
	spec_ready: false,
	media_ready: false,
	quality_pass: false,
	publish_verified: false,
};

const FINGERPRINT_PREFIX = "inputs_v2:";

const SOURCE_GROUPS = {
	research: [
		"src/domain/agents/research.ts",
		"src/domain/byosan/news_angle.ts",
		"config/sources/byosan_discovery_sources.json",
	],
	spec: [
		"src/domain/byosan/feature_spec.ts",
		"src/domain/byosan/feature_repair.ts",
		"src/domain/byosan/explanation.ts",
	],
	media: ["src/scripts/produce_byosan_feature.ts"],
	publish: [
		"src/scripts/publish_youtube.ts",
		"src/domain/publication_state.ts",
	],
} as const;

function fileContent(absolutePath: string): Buffer | "MISSING" {
	return fs.existsSync(absolutePath)
		? fs.readFileSync(absolutePath)
		: "MISSING";
}

function hashFiles(root: string, files: readonly string[]): string {
	const hash = createHash("sha256");
	for (const relativePath of files) {
		hash.update(relativePath);
		hash.update("\0");
		hash.update(fileContent(path.join(root, relativePath)));
		hash.update("\0");
	}
	return hash.digest("hex");
}

function readByosanConfigFile(root: string): Record<string, unknown> {
	return yaml.load(
		fs.readFileSync(path.join(root, BYOSAN_CONFIG_RELATIVE_PATH), "utf8"),
	) as Record<string, unknown>;
}

function inputFingerprint(parts: ReadonlyArray<string | Buffer>): string {
	const hash = createHash("sha256");
	for (const part of parts) {
		hash.update(part);
		hash.update("\0");
	}
	return `${FINGERPRINT_PREFIX}${hash.digest("hex")}`;
}

function researchFingerprint(root: string, runDir: string): string {
	const config = readByosanConfigFile(root);
	return inputFingerprint([
		hashFiles(root, SOURCE_GROUPS.research),
		JSON.stringify({
			prompts: (config.prompts as { research: unknown }).research,
			discovery: config.discovery,
		}),
		fileContent(path.join(runDir, "research", "discovery_articles.json")),
	]);
}

function specFingerprint(root: string): string {
	const config = readByosanConfigFile(root);
	return inputFingerprint([
		hashFiles(root, SOURCE_GROUPS.spec),
		JSON.stringify({
			prompts: config.prompts,
			explain: config.explain,
			repair: config.repair,
			llm: config.llm,
		}),
	]);
}

export function currentByosanFingerprints(
	root: string,
	runDir: string,
): ByosanCheckpoint["fingerprints"] {
	return {
		research: researchFingerprint(root, runDir),
		spec: specFingerprint(root),
		media: hashFiles(root, SOURCE_GROUPS.media),
		publish: hashFiles(root, SOURCE_GROUPS.publish),
	};
}

function checkpointPath(runDir: string): string {
	return path.join(runDir, "state.json");
}

function readByosanCheckpoint(runDir: string): ByosanCheckpoint | null {
	const statePath = checkpointPath(runDir);
	if (!fs.existsSync(statePath)) return null;
	try {
		const state = fs.readJsonSync(statePath) as { byosan_checkpoint?: unknown };
		const value = state.byosan_checkpoint;
		if (!value || typeof value !== "object") return null;
		const checkpoint = value as Partial<ByosanCheckpoint>;
		if (
			checkpoint.schema_version !== "byosan_checkpoint_v1" ||
			typeof checkpoint.run_id !== "string" ||
			!checkpoint.fingerprints ||
			!checkpoint.stages
		) {
			return null;
		}
		return checkpoint as ByosanCheckpoint;
	} catch {
		return null;
	}
}

function researchArtifactCurrent(runDir: string): boolean {
	return isCurrentByosanAngleDecision(
		readJsonIfExists(path.join(runDir, "source", "research_result.json"))
			?.angle_decision,
	);
}

function specArtifactExists(runDir: string): boolean {
	return fs.existsSync(path.join(runDir, "source", "feature_spec.json"));
}

function legacyStages(
	runDir: string,
	stages: ByosanCheckpointStages,
): ByosanCheckpointStages {
	const researchReady = researchArtifactCurrent(runDir);
	return {
		...stages,
		research_ready: researchReady,
		spec_ready: researchReady && specArtifactExists(runDir),
	};
}

function readJsonIfExists(
	filePath: string,
): { angle_decision?: unknown } | undefined {
	return fs.existsSync(filePath)
		? (fs.readJsonSync(filePath) as { angle_decision?: unknown })
		: undefined;
}

export function reconcileByosanCheckpoint(
	runDir: string,
	runId: string,
	root: string,
): ByosanCheckpoint {
	const fingerprints = currentByosanFingerprints(root, runDir);
	const previous = readByosanCheckpoint(runDir);
	if (!previous || previous.run_id !== runId) {
		return {
			schema_version: "byosan_checkpoint_v1",
			run_id: runId,
			fingerprints,
			stages: { ...EMPTY_STAGES },
			updated_at: new Date().toISOString(),
		};
	}

	const legacy = !previous.fingerprints.research.startsWith(FINGERPRINT_PREFIX);
	const stages = legacy
		? legacyStages(runDir, previous.stages)
		: { ...previous.stages };
	if (!legacy && previous.fingerprints.research !== fingerprints.research) {
		Object.assign(stages, EMPTY_STAGES);
	} else if (!legacy && previous.fingerprints.spec !== fingerprints.spec) {
		stages.spec_ready = false;
		stages.media_ready = false;
		stages.quality_pass = false;
		stages.publish_verified = false;
	} else if (previous.fingerprints.media !== fingerprints.media) {
		stages.media_ready = false;
		stages.quality_pass = false;
		stages.publish_verified = false;
	} else if (previous.fingerprints.publish !== fingerprints.publish) {
		stages.publish_verified = false;
	}
	if (!legacy && previous.fingerprints.research === fingerprints.research) {
		stages.research_ready =
			stages.research_ready || researchArtifactCurrent(runDir);
		stages.spec_ready =
			stages.spec_ready ||
			(stages.research_ready &&
				previous.fingerprints.spec === fingerprints.spec &&
				specArtifactExists(runDir));
	}
	return {
		...previous,
		fingerprints,
		stages,
		updated_at: new Date().toISOString(),
	};
}

export function writeByosanCheckpoint(
	runDir: string,
	checkpoint: ByosanCheckpoint,
): void {
	const statePath = checkpointPath(runDir);
	const state = fs.existsSync(statePath)
		? (fs.readJsonSync(statePath) as Record<string, unknown>)
		: {};
	fs.outputJsonSync(
		statePath,
		{
			...state,
			byosan_checkpoint: {
				...checkpoint,
				updated_at: new Date().toISOString(),
			},
		},
		{ spaces: 2 },
	);
}
