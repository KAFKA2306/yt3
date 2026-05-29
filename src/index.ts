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
		const finalVideoId = finalState.publish_results?.youtube?.video_id;
		const finalUrl = finalVideoId
			? `https://www.youtube.com/watch?v=${finalVideoId}`
			: "(No URL Available)";

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

		if (finalState.status === "SUCCESS") {
			fs.writeFileSync(
				path.join(store.runDir, "SUCCESS"),
				`Published at ${new Date().toISOString()}\nVideo: ${finalUrl}`,
			);
			console.log(`\n${"=".repeat(80)}`);
			console.log("🚀 PIPELINE SUCCESSFUL");
			console.log(`🎬 TITLE: ${finalTitle}`);
			console.log(`🔗 URL:   ${finalUrl}`);
			console.log(`${"=".repeat(80)}\n`);
		} else {
			console.log(`\n${"!".repeat(80)}`);
			console.log(`⚠️ PIPELINE FAILED: ${finalState.status}`);
			console.log(`${"!".repeat(80)}\n`);

			await sendAlert(`⚠️ **Pipeline Failed** (Run: \`${runId}\`)`, "warn", {
				status: finalState.status,
				bucket: BUCKET,
			});

			process.exit(1);
		}
	} catch (err) {
		const error = err as Error;
		appendLoopMemory(store, {
			run_id: runId,
			bucket: BUCKET,
			stage: "pipeline",
			kind: "failure",
			summary:
				"Uncaught pipeline crash. The loop should convert this failure into a reusable memory note before the next scheduled run.",
			signals: [error.message],
			fixes: [
				"read the terminal error once, then route the next run through cached research or deterministic fallback",
				"avoid repeated retries when the failure is already a quota or integrity terminal state",
			],
			timestamp: new Date().toISOString(),
		});
		AgentLogger.error("SYSTEM", "PIPE", "CRASH", error.message, error);
		await sendAlert(`🔥 **Pipeline Crashed** (Run: \`${runId}\`)`, "error", {
			message: error.message,
			stack: error.stack?.slice(0, 500),
		});
		process.exit(1);
	}
}

main();
