import { spawn } from "node:child_process";
import path from "node:path";
import { google } from "googleapis";
import { PublishAgent } from "../domain/agents/publish.js";
import { type AgentState, AgentStateSchema } from "../domain/types.js";
import {
	assertYouTubeChannelMatchesProfile,
	hydrateOAuthCredentials,
	loadYouTubeProfileEnv,
} from "../domain/youtube_profiles.js";
import { AssetStore } from "../io/core.js";
import {
	classifyFailureMessage,
	resolveDailyLogPath,
	writeRunEvidence,
} from "../io/utils/stability.js";

async function runProductReleaseCheck(
	runId: string,
	publishVideoPath?: string,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const args = ["src/scripts/check_product_release.ts", runId];
		if (publishVideoPath) args.push(publishVideoPath);
		const child = spawn("bun", args, {
			cwd: process.cwd(),
			env: process.env,
			stdio: "inherit",
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) resolve();
			else
				reject(
					new Error(
						`product release check failed with exit code ${code ?? "null"}`,
					),
				);
		});
	});
}

function canonicalRunId(rawRunId: string, bucket: string): string {
	const runId = rawRunId.includes("/") ? rawRunId : `${bucket}/${rawRunId}`;
	const [domain, name, ...rest] = runId.split("/");
	if (domain !== bucket || !name || rest.length > 0) {
		throw new Error(
			`YouTube publish requires RUN_ID in '${bucket}/<run>' form; got '${rawRunId}'`,
		);
	}
	return runId;
}

async function main() {
	const profile = loadYouTubeProfileEnv();
	const rawRunId = process.env.RUN_ID || process.argv[2];
	if (!rawRunId) {
		throw new Error(
			`RUN_ID is required for publish profile '${profile.profileName}'`,
		);
	}
	const runId = canonicalRunId(rawRunId, profile.bucket);
	const publishVideoPath = process.argv[3]?.trim() || undefined;

	await runProductReleaseCheck(runId, publishVideoPath);

	const clientId = process.env.YOUTUBE_CLIENT_ID;
	const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error(
			`YouTube publish failed for profile '${profile.profileName}': YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET are required`,
		);
	}

	const auth = new google.auth.OAuth2({
		clientId,
		clientSecret,
		redirectUri:
			process.env.YOUTUBE_REDIRECT_URI ||
			"http://localhost:3310/oauth2callback",
	});
	await hydrateOAuthCredentials(auth, profile);
	const channel = await assertYouTubeChannelMatchesProfile(auth, profile);
	console.log(
		`CHANNEL: ${channel.actual.title} ${channel.actual.handle ?? ""}`.trim(),
	);

	const store = new AssetStore(runId);
	const state = AgentStateSchema.passthrough().parse(
		store.loadState(),
	) as AgentState;
	if (publishVideoPath) state.publish_video_path = publishVideoPath;

	try {
		const results = await new PublishAgent(store).run(state);
		writeRunEvidence(store.runDir, {
			run_id: runId,
			bucket: profile.bucket,
			status: "SUCCESS",
			disposition: "success",
			log_path: resolveDailyLogPath(runId),
			evidence_paths: [
				path.join(store.runDir, "state.json"),
				path.join(store.runDir, "publish", "state.json"),
				path.join(store.runDir, "publish", "receipt.json"),
			],
			artifact_paths: [
				publishVideoPath || state.publish_video_path || state.video_path || "",
			].filter(Boolean),
			note: `YouTube publication verified for profile ${profile.profileName}; video_id=${results.youtube?.video_id ?? "none"}.`,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const failure = classifyFailureMessage(message);
		writeRunEvidence(store.runDir, {
			run_id: runId,
			bucket: profile.bucket,
			status:
				failure.disposition === "blocked"
					? "PUBLISH_BLOCKED"
					: failure.disposition === "retryable"
						? "RETRYABLE"
						: failure.disposition === "pending"
							? "PENDING"
							: "FAILED",
			disposition: failure.disposition,
			log_path: resolveDailyLogPath(runId),
			evidence_paths: [
				path.join(store.runDir, "state.json"),
				path.join(store.runDir, "publish", "state.json"),
			].filter((candidate) => candidate.length > 0),
			artifact_paths: [
				publishVideoPath || state.publish_video_path || state.video_path || "",
			].filter(Boolean),
			failure,
			note: "YouTube publication failed after the product release gate.",
		});
		throw error;
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
