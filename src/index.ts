import { AssetStore, getRunIdDateString, loadConfig } from "./core.js";
import { AgentLogger } from "./utils/logger.js";

async function main() {
  const defaultRunId = getRunIdDateString();
  const RUN_ID = process.env["RUN_ID"] || defaultRunId;
  const runId = RUN_ID === "latest" ? defaultRunId : RUN_ID;
  const store = new AssetStore(runId);

  AgentLogger.init();
  AgentLogger.info("SYSTEM", "BOOT", "INIT", `Starting AI YouTuber Pipeline (RunID: ${runId})`);

  const BUCKET = process.env["BUCKET"] || loadConfig().workflow.default_bucket;

  try {
    AgentLogger.info("SYSTEM", "PIPE", "START", `Executing pipeline for bucket: ${BUCKET}`);
    console.log("Store initialized for", store.runDir);

    const { createGraph } = await import("./graph.js");
    const graph = createGraph(store);

    const initialState = {
      run_id: runId,
      bucket: BUCKET,
    };

    const finalState = await graph.invoke(initialState);
    AgentLogger.info("SYSTEM", "PIPE", "SUCCESS", "Pipeline execution completed successfully", {
      context: { status: (finalState as Record<string, unknown>)["status"] },
    });
  } catch (err) {
    AgentLogger.error("SYSTEM", "PIPE", "FATAL", String(err));
    process.exit(1);
  }
}

main();
