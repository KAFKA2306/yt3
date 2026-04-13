import {
	type AgentState,
	AssetStore,
	getRunIdDateString,
	loadConfig,
} from "./io/core.js";
import { AgentLogger } from "./io/utils/logger.js";
async function main() {
	const defaultRunId = getRunIdDateString();
	const RUN_ID = process.env.RUN_ID || defaultRunId;
	const runId = RUN_ID === "latest" ? defaultRunId : RUN_ID;
	const store = new AssetStore(runId);
	AgentLogger.init();
	AgentLogger.info(
		"SYSTEM",
		"BOOT",
		"INIT",
		`Starting AI YouTuber Pipeline (RunID: ${runId})`,
	);
	const BUCKET = process.env.BUCKET || loadConfig().workflow.default_bucket;
	const MISSION_FILE = process.env.MISSION_FILE;
	const { createGraph } = await import("./graph.js");
	const graph = createGraph(store);
	const initialState = {
		run_id: runId,
		bucket: BUCKET,
		mission_file: MISSION_FILE,
	};
	const finalState = (await (
		graph as { invoke: (s: AgentState) => Promise<AgentState> }
	).invoke(initialState)) as unknown as AgentState;

	const finalTitle = finalState.metadata?.title || "Unknown Title";
	const finalVideoId = finalState.publish_results?.youtube?.video_id;
	const finalUrl = finalVideoId
		? `https://www.youtube.com/watch?v=${finalVideoId}`
		: "(No URL Available)";

	AgentLogger.info(
		"SYSTEM",
		"PIPE",
		"SUCCESS",
		"Pipeline execution completed successfully",
		{
			context: {
				status: finalState.status,
				title: finalTitle,
				url: finalUrl,
			},
		},
	);

	console.log(`\n${"=".repeat(80)}`);
	console.log("🚀 PIPELINE SUCCESSFUL");
	console.log(`🎬 TITLE: ${finalTitle}`);
	console.log(`🔗 URL:   ${finalUrl}`);
	console.log(`${"=".repeat(80)}\n`);
}
main();
