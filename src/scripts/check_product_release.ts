import path from "node:path";
import fs from "fs-extra";
import { assertProductReleaseGate } from "../domain/product_release_gate.js";
import { AgentStateSchema, type AgentState } from "../domain/types.js";
import {
	assertProfileEnvFile,
	getYouTubeProfile,
} from "../domain/youtube_profiles.js";
import { loadConfig } from "../io/core.js";

function resolveRunId(rawRunId: string, bucket: string): string {
	const runId = rawRunId.includes("/") ? rawRunId : `${bucket}/${rawRunId}`;
	const parts = runId.split("/");
	if (parts.length !== 2 || parts[0] !== bucket || !parts[1]) {
		throw new Error(
			`Product release requires RUN_ID in '${bucket}/<run>' form; got '${rawRunId}'`,
		);
	}
	return runId;
}

async function main() {
	const profile = getYouTubeProfile();
	assertProfileEnvFile(profile, process.env.ENV_FILE);

	const rawRunId = process.env.RUN_ID || process.argv[2];
	if (!rawRunId) {
		throw new Error(
			`RUN_ID is required for product release profile '${profile.profileName}'`,
		);
	}
	const runId = resolveRunId(rawRunId, profile.bucket);
	const runName = runId.split("/")[1];
	if (!runName) throw new Error(`Malformed RUN_ID '${runId}'`);

	const cfg = loadConfig(profile.bucket);
	const runDir = path.join(
		process.cwd(),
		cfg.workflow.paths.runs_dir,
		profile.bucket,
		runName,
	);
	if (!fs.existsSync(runDir)) {
		throw new Error(`Product release blocked: run directory does not exist: ${runDir}`);
	}

	const statePath = path.join(runDir, cfg.workflow.filenames.state);
	if (!fs.existsSync(statePath)) {
		throw new Error(`Product release blocked: state file does not exist: ${statePath}`);
	}
	const state = AgentStateSchema.passthrough().parse(fs.readJsonSync(statePath)) as AgentState & {
		source_manifest_path?: string;
	};
	const publishVideoPath = process.argv[3]?.trim() || undefined;
	const requireFactualIntegrity = cfg.steps.youtube?.default_visibility !== "private";

	const result = assertProductReleaseGate({
		runDir,
		runId,
		state,
		profile,
		publishVideoPath,
		requireFactualIntegrity,
	});

	console.log(
		`[product-release-gate] PASS profile=${result.profile} run=${result.runId} artifact_sha256=${result.artifactSha256}`,
	);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
