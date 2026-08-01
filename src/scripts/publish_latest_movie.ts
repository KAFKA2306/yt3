import path from "node:path";
import dotenv from "dotenv";
import fs from "fs-extra";
import { PublishAgent } from "../domain/agents/publish.js";
import type { AgentState } from "../domain/types.js";
import {
	assertProfileEnvFile,
	getYouTubeProfile,
} from "../domain/youtube_profiles.js";
import { AssetStore } from "../io/core.js";
import {
	classifyFailureMessage,
	findLatestRunForBucket,
	resolveDailyLogPath,
	writeRunEvidence,
} from "../io/utils/stability.js";

const envFile = process.env.ENV_FILE?.trim();
if (!envFile) {
	throw new Error("ENV_FILE is required for latest movie publish");
}

const envFilePath = path.isAbsolute(envFile)
	? envFile
	: path.join(process.cwd(), envFile);

dotenv.config({ path: envFilePath, override: true });

function inferMetadata(videoPath: string) {
	const baseName = path.basename(videoPath, path.extname(videoPath));
	const title = baseName.replace(/[_-]+/g, " ").trim() || "Latest Movie";
	return {
		title,
		thumbnail_title: title,
		description: `Published from the latest generated movie: ${title}`,
		tags: ["video", "publish", "latest"],
	};
}

function resolveRunId(profileBucket: string, overrideRunId?: string): string {
	if (overrideRunId?.trim()) {
		const trimmed = overrideRunId.trim();
		return trimmed.includes("/") ? trimmed : `${profileBucket}/${trimmed}`;
	}

	const latest = findLatestRunForBucket(profileBucket);
	if (!latest) {
		throw new Error(
			`No published video candidate found under runs/${profileBucket}`,
		);
	}
	return latest.runId;
}

async function main() {
	const profile = getYouTubeProfile();
	assertProfileEnvFile(profile, process.env.ENV_FILE);

	const explicitRunId = process.env.RUN_ID?.trim() || process.argv[2]?.trim();
	const targetRunId = resolveRunId(profile.bucket, explicitRunId);
	const targetBucket = targetRunId.split("/")[0];
	if (targetBucket !== profile.bucket) {
		throw new Error(
			`RUN_ID bucket mismatch: expected '${profile.bucket}' but got '${targetBucket}'`,
		);
	}
	const store = new AssetStore(targetRunId);
	const publishAgent = new PublishAgent(store);
	const loadedState = store.loadState();
	const resolvedVideoPath =
		process.env.PUBLISH_VIDEO_PATH?.trim() ||
		publishAgent.previewPublishVideoPath({
			...loadedState,
			run_id: targetRunId,
			bucket: profile.bucket,
			video_path: loadedState.video_path,
			publish_video_path: loadedState.publish_video_path,
			metadata: loadedState.metadata,
		}) ||
		"";

	if (!resolvedVideoPath) {
		throw new Error(
			`Unable to resolve a publish video for run '${targetRunId}'`,
		);
	}

	const state: AgentState = {
		...loadedState,
		run_id: targetRunId,
		bucket: profile.bucket,
		video_path: loadedState.video_path || resolvedVideoPath,
		publish_video_path: resolvedVideoPath,
		metadata: loadedState.metadata || inferMetadata(resolvedVideoPath),
	};

	console.log(`RUN_ID=${targetRunId}`);
	console.log(`VIDEO_PATH=${resolvedVideoPath}`);

	try {
		const result = await publishAgent.run(state);
		store.updateState({
			publish_results: result,
			publish_video_path: resolvedVideoPath,
		});
		const publicUrl = result.youtube?.video_id
			? `https://www.youtube.com/watch?v=${result.youtube.video_id}`
			: "";
		fs.writeFileSync(
			path.join(store.runDir, "SUCCESS"),
			`Published at ${new Date().toISOString()}\nVideo: ${resolvedVideoPath}`,
		);
		const evidencePath = writeRunEvidence(store.runDir, {
			run_id: targetRunId,
			bucket: profile.bucket,
			status: "SUCCESS",
			disposition: "success",
			log_path: resolveDailyLogPath(targetRunId),
			evidence_paths: [
				path.join(store.runDir, "SUCCESS"),
				path.join(store.runDir, "state.json"),
				path.join(store.runDir, "publish", "receipt.json"),
			],
			artifact_paths: [resolvedVideoPath],
			note: "Latest generated movie was published with explicit evidence.",
		});
		if (publicUrl) {
			console.log(`PUBLIC_URL=${publicUrl}`);
		}
		console.log(
			`RECEIPT_PATH=${path.join(store.runDir, "publish", "receipt.json")}`,
		);
		console.log(`EVIDENCE_PATH=${evidencePath}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const failure = classifyFailureMessage(message);
		const status =
			failure.disposition === "blocked"
				? "PUBLISH_BLOCKED"
				: failure.disposition === "retryable"
					? "RETRYABLE"
					: failure.disposition === "pending"
						? "PENDING"
						: "FAILED";
		const evidencePath = writeRunEvidence(store.runDir, {
			run_id: targetRunId,
			bucket: profile.bucket,
			status,
			disposition: failure.disposition,
			log_path: resolveDailyLogPath(targetRunId),
			evidence_paths: [path.join(store.runDir, "state.json")],
			artifact_paths: resolvedVideoPath ? [resolvedVideoPath] : [],
			failure,
			note: "Latest generated movie publish failed and was classified.",
		});
		console.error(message);
		console.error(`EVIDENCE_PATH=${evidencePath}`);
		process.exit(1);
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
