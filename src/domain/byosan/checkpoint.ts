import { createHash } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";

export type ByosanCheckpointStages = {
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

const EMPTY_STAGES: ByosanCheckpointStages = {
	research_ready: false,
	spec_ready: false,
	media_ready: false,
	quality_pass: false,
	publish_verified: false,
};

const SOURCE_GROUPS = {
	research: [
		"src/domain/agents/research.ts",
		"src/domain/byosan/news_angle.ts",
		"src/scripts/byosan_daily.ts",
	],
	spec: ["src/domain/byosan/feature_spec.ts", "src/scripts/byosan_daily.ts"],
	media: ["src/scripts/produce_byosan_feature.ts"],
	publish: [
		"src/scripts/publish_youtube.ts",
		"src/domain/publication_state.ts",
	],
} as const;

function hashFiles(root: string, files: readonly string[]): string {
	const hash = createHash("sha256");
	for (const relativePath of files) {
		const absolutePath = path.join(root, relativePath);
		hash.update(relativePath);
		hash.update("\0");
		hash.update(
			fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath) : "MISSING",
		);
		hash.update("\0");
	}
	return hash.digest("hex");
}

export function currentByosanFingerprints(
	root: string,
): ByosanCheckpoint["fingerprints"] {
	return {
		research: hashFiles(root, SOURCE_GROUPS.research),
		spec: hashFiles(root, SOURCE_GROUPS.spec),
		media: hashFiles(root, SOURCE_GROUPS.media),
		publish: hashFiles(root, SOURCE_GROUPS.publish),
	};
}

function checkpointPath(runDir: string): string {
	return path.join(runDir, "state.json");
}

export function readByosanCheckpoint(runDir: string): ByosanCheckpoint | null {
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

export function reconcileByosanCheckpoint(
	runDir: string,
	runId: string,
	root: string,
): ByosanCheckpoint {
	const fingerprints = currentByosanFingerprints(root);
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

	const stages = { ...previous.stages };
	if (previous.fingerprints.research !== fingerprints.research) {
		Object.assign(stages, EMPTY_STAGES);
	} else if (previous.fingerprints.spec !== fingerprints.spec) {
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
