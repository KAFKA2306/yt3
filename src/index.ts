import path from "node:path";
import fs from "fs-extra";
import { loadYouTubeProfileEnv } from "./domain/youtube_profiles.js";
import {
	type AgentState,
	AssetStore,
	appendLoopMemory,
	getRunIdDateString,
	loadConfig,
} from "./io/core.js";
import { sendAlert } from "./io/utils/discord.js";
import { AgentLogger } from "./io/utils/logger.js";
import {
	classifyFailureMessage,
	resolveDailyLogPath,
	writeRunEvidence,
} from "./io/utils/stability.js";

function resolveRunId(bucket: string): string {
	const raw = process.env.RUN_ID?.trim() || getRunIdDateString();
	if (!raw.includes("/")) return `${bucket}/${raw}`;
	const [domain, name, ...rest] = raw.split("/");
	if (domain !== bucket || !name || rest.length > 0) {
		throw new Error(
			`Domain mismatch: profile bucket is '${bucket}' but RUN_ID is '${raw}'`,
		);
	}
	return raw;
}

async function main() {
	const requestedProfile =
		process.env.YOUTUBE_CHANNEL_PROFILE?.trim() || "byosan";
	if (requestedProfile === "yawa") {
		throw new Error("PROFILE=yawa uses the ASMR workflow, not src/index.ts");
	}
	const profile = loadYouTubeProfileEnv(requestedProfile);
	const bucket = profile.bucket;
	loadConfig(bucket);
	const runId = resolveRunId(bucket);
	const store = new AssetStore(runId);
	AgentLogger.init();

	try {
		AgentLogger.info(
			"SYSTEM",
			"BOOT",
			"INIT",
			`Starting AI YouTuber Pipeline (RunID: ${runId})`,
		);
		const missionFile = process.env.MISSION_FILE;
		const { runSequentialWorkflow } = await import("./workflow.js");
		const { runHumanityObservatoryWorkflow } = await import(
			"./humanity_observatory_workflow.js"
		);

		const initialState: Partial<AgentState> = {
			run_id: runId,
			bucket,
			mission_file: missionFile,
		};
		const finalState =
			bucket === "humanity_observatory"
				? await runHumanityObservatoryWorkflow(store, initialState)
				: await runSequentialWorkflow(store, initialState);

		const finalTitle = finalState.metadata?.title || "Unknown Title";
		const publishStatePath = path.join(store.runDir, "publish", "state.json");
		const receiptPath = path.join(store.runDir, "publish", "receipt.json");
		const publicationState = fs.existsSync(publishStatePath)
			? fs.readJsonSync(publishStatePath)
			: undefined;
		const receipt = fs.existsSync(receiptPath)
			? fs.readJsonSync(receiptPath)
			: undefined;
		const finalVideoId =
			typeof receipt?.youtube?.video_id === "string"
				? receipt.youtube.video_id
				: undefined;
		const finalUrl = finalVideoId
			? `https://www.youtube.com/watch?v=${finalVideoId}`
			: "(No URL Available)";
		const hasPublishProof =
			Boolean(finalVideoId) &&
			publicationState?.phase === "VERIFIED" &&
			publicationState?.video_id === finalVideoId;

		AgentLogger.info(
			"SYSTEM",
			"PIPE",
			"FINALIZE",
			"Pipeline execution cycle finished",
			{
				context: {
					status: finalState.status,
					title: finalTitle,
					url: finalUrl,
				},
			},
		);

		if (finalState.status === "SUCCESS" && hasPublishProof) {
			writeRunEvidence(store.runDir, {
				run_id: runId,
				bucket,
				status: finalState.status,
				disposition: "success",
				log_path: resolveDailyLogPath(runId),
				evidence_paths: [
					path.join(store.runDir, "state.json"),
					publishStatePath,
					receiptPath,
				],
				artifact_paths: [finalUrl],
				note: "Pipeline completed with canonical publication state and receipt evidence.",
			});
			console.log(`\n${"=".repeat(80)}`);
			console.log("🚀 PIPELINE SUCCESSFUL");
			console.log(`🎬 TITLE: ${finalTitle}`);
			console.log(`🔗 URL:   ${finalUrl}`);
			console.log(`${"=".repeat(80)}\n`);
			return;
		}

		if (finalState.status === "SUCCESS") {
			writeRunEvidence(store.runDir, {
				run_id: runId,
				bucket,
				status: "PENDING",
				disposition: "pending",
				log_path: resolveDailyLogPath(runId),
				evidence_paths: [path.join(store.runDir, "state.json")],
				artifact_paths: [],
				note: "Pipeline reported success without a VERIFIED canonical publication state and matching receipt.",
			});
			console.log(`\n${"!".repeat(80)}`);
			console.log("⚠️ PIPELINE REPORTED SUCCESS WITHOUT VERIFIED PUBLICATION");
			console.log(`${"!".repeat(80)}\n`);
			return;
		}

		const failure = classifyFailureMessage(finalState.status || "UNKNOWN");
		writeRunEvidence(store.runDir, {
			run_id: runId,
			bucket,
			status: finalState.status || "UNKNOWN",
			disposition: failure.disposition,
			log_path: resolveDailyLogPath(runId),
			evidence_paths: [path.join(store.runDir, "state.json")],
			artifact_paths: [],
			failure,
			note: "Run completed without verified publication evidence; status is explicitly classified.",
		});
		await sendAlert(`⚠️ **Pipeline Failed** (Run: \`${runId}\`)`, "warn", {
			status: finalState.status,
			bucket,
		});
		if (failure.disposition === "fatal") process.exit(1);
	} catch (err) {
		const error = err as Error;
		const failure = classifyFailureMessage(error.message);
		appendLoopMemory(store, {
			run_id: runId,
			bucket,
			stage: "pipeline",
			kind: "failure",
			summary:
				"Uncaught pipeline crash. The loop should convert this failure into a reusable memory note before the next scheduled run.",
			signals: [error.message],
			fixes: [
				"read the terminal error once, then fix the failing harness step before retrying",
				"avoid repeated retries when the failure is already a quota or integrity terminal state",
			],
			timestamp: new Date().toISOString(),
		});
		AgentLogger.error("SYSTEM", "PIPE", "CRASH", error.message, error);
		writeRunEvidence(store.runDir, {
			run_id: runId,
			bucket,
			status: "CRASH",
			disposition: failure.disposition,
			log_path: resolveDailyLogPath(runId),
			evidence_paths: [path.join(store.runDir, "state.json")],
			artifact_paths: [],
			failure,
			note: "Uncaught exception was classified and written to evidence before exit.",
		});
		await sendAlert(`🔥 **Pipeline Crashed** (Run: \`${runId}\`)`, "error", {
			message: error.message,
			stack: error.stack?.slice(0, 500),
		});
		if (failure.disposition === "fatal") process.exit(1);
	}
}

main();
