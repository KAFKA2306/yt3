import { AssetStore, getRunIdDateString, loadConfig } from "./core.js";
import { AgentLogger } from "./utils/logger.js";
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
	const finalState = await graph.invoke(initialState);
	AgentLogger.info(
		"SYSTEM",
		"PIPE",
		"SUCCESS",
		"Pipeline execution completed successfully",
		{
			context: { status: (finalState as Record<string, unknown>).status },
		},
	);
}
main();
