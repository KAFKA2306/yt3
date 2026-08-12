import path from "node:path";
import fs from "fs-extra";
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

async function main() {
	const defaultRunId = getRunIdDateString();
	const RUN_ID = process.env.RUN_ID || defaultRunId;
	let runId = RUN_ID === "latest" ? defaultRunId : RUN_ID;

	const BUCKET = process.env.BUCKET || loadConfig().workflow.default_bucket;
	if (BUCKET === "humanity_observatory") {
		if (RUN_ID.includes("/") && !RUN_ID.startsWith("humanity_observatory/")) {
			throw new Error(
				`Domain mismatch: BUCKET is ${BUCKET} but RUN_ID starts with a different prefix: ${RUN_ID}`,
			);
		}
		runId = RUN_ID.startsWith("humanity_observatory/")
			? RUN_ID
			: `humanity_observatory/${runId}`;
	} else {
		if (RUN_ID.includes("/") && !RUN_ID.startsWith(`${BUCKET}/`)) {
			throw new Error(
				`Domain mismatch: BUCKET is ${BUCKET} but RUN_ID starts with a different prefix: ${RUN_ID}`,
			);
		}
		runId = RUN_ID.startsWith(`${BUCKET}/`) ? RUN_ID : `${BUCKET}/${runId}`;
	}

	const store = new AssetStore(runId);
	AgentLogger.init();

	try {
		AgentLogger.info(
			"SYSTEM",
			"BOOT",
			"INIT",
			`Starting AI YouTuber Pipeline (RunID: ${runId})`,
		);
		const MISSION_FILE = process.env.MISSION_FILE;
		const { runSequentialWorkflow } = await import("./workflow.js");
		const { runHumanityObservatoryWorkflow } = await import(
			"./humanity_observatory_workflow.js"
		);

		const initialState = {
			run_id: runId,
			bucket: BUCKET,
			mission_file: MISSION_FILE,
		};

		const finalState =
			BUCKET === "humanity_observatory"
				? await runHumanityObservatoryWorkflow(store, initialState)
				: await runSequentialWorkflow(store, initialState);

		const finalTitle = finalState.metadata?.title || "Unknown Title";
		const publishReceiptPath = path.join(
			store.runDir,
			"publish",
			"receipt.json",
		);
		const publishReceipt = fs.existsSync(publishReceiptPath)
			? fs.readJsonSync(publishReceiptPath)
			: undefined;
		const finalVideoId =
			typeof publishReceipt?.youtube?.video_id === "string"
				? publishReceipt.youtube.video_id
				: finalState.publish_results?.youtube?.video_id;
		const finalUrl = finalVideoId
			? `https://www.youtube.com/watch?v=${finalVideoId}`
			: "(No URL Available)";
		const hasPublishProof =
			Boolean(finalVideoId) && fs.existsSync(publishReceiptPath);

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
			fs.writeFileSync(
				path.join(store.runDir, "SUCCESS"),
				`Published at ${new Date().toISOString()}\nVideo: ${finalUrl}`,
			);
			writeRunEvidence(store.runDir, {
				run_id: runId,
				bucket: BUCKET,
				status: finalState.status,
				disposition: "success",
				log_path: resolveDailyLogPath(runId),
				evidence_paths: [
					path.join(store.runDir, "SUCCESS"),
					path.join(store.runDir, "state.json"),
					path.join(store.runDir, "publish", "receipt.json"),
				],
				artifact_paths: [
					finalUrl !== "(No URL Available)" ? finalUrl : "",
				].filter(Boolean),
				note: "Pipeline completed with machine-verifiable success evidence.",
			});
			console.log(`\n${"=".repeat(80)}`);
			console.log("🚀 PIPELINE SUCCESSFUL");
			console.log(`🎬 TITLE: ${finalTitle}`);
			console.log(`🔗 URL:   ${finalUrl}`);
			console.log(`${"=".repeat(80)}\n`);
		} else if (finalState.status === "SUCCESS" && !hasPublishProof) {
			writeRunEvidence(store.runDir, {
				run_id: runId,
				bucket: BUCKET,
				status: "PENDING",
				disposition: "pending",
				log_path: resolveDailyLogPath(runId),
				evidence_paths: [path.join(store.runDir, "state.json")],
				artifact_paths: [],
				note: "Pipeline reported success, but no publish proof was present; treating this as evidence gap.",
			});
			console.log(`\n${"!".repeat(80)}`);
			console.log("⚠️ PIPELINE REPORTED SUCCESS WITHOUT PUBLISH PROOF");
			console.log(`🎬 TITLE: ${finalTitle}`);
			console.log(`🔗 URL:   ${finalUrl}`);
			console.log(`${"!".repeat(80)}\n`);
		} else {
			const failure = classifyFailureMessage(finalState.status || "UNKNOWN");
			writeRunEvidence(store.runDir, {
				run_id: runId,
				bucket: BUCKET,
				status: finalState.status || "UNKNOWN",
				disposition: failure.disposition,
				log_path: resolveDailyLogPath(runId),
				evidence_paths: [path.join(store.runDir, "state.json")],
				artifact_paths: [],
				failure,
				note: "Run completed without success evidence; status is explicitly classified.",
			});
			console.log(`\n${"!".repeat(80)}`);
			console.log(`⚠️ PIPELINE FAILED: ${finalState.status}`);
			console.log(`${"!".repeat(80)}\n`);

			await sendAlert(`⚠️ **Pipeline Failed** (Run: \`${runId}\`)`, "warn", {
				status: finalState.status,
				bucket: BUCKET,
			});

			if (failure.disposition === "fatal") {
				process.exit(1);
			}
		}
	} catch (err) {
		const error = err as Error;
		const failure = classifyFailureMessage(error.message);
		appendLoopMemory(store, {
			run_id: runId,
			bucket: BUCKET,
			stage: "pipeline",
			kind: failure.disposition === "success" ? "success" : "failure",
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
			bucket: BUCKET,
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
		if (failure.disposition === "fatal") {
			process.exit(1);
		}
	}
}

main();
