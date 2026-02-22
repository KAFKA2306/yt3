import { AssetStore, loadConfig } from "./core.js";
import { AgentLogger } from "./utils/logger.js";

async function main() {
  const RUN_ID = process.env["RUN_ID"] || `run_${Date.now()}`;
  const runId = RUN_ID === "latest" ? `run_${Date.now()}` : RUN_ID;
  const store = new AssetStore(runId);

  AgentLogger.init();
  AgentLogger.info("SYSTEM", "BOOT", "INIT", `Starting AI YouTuber Pipeline (RunID: ${runId})`);

  const BUCKET = process.env["BUCKET"] || loadConfig().workflow.default_bucket;

  try {
    AgentLogger.info("SYSTEM", "PIPE", "START", `Executing pipeline for bucket: ${BUCKET}`);
    console.log("Store initialized for", store.runDir);
  } catch (err) {
    AgentLogger.error("SYSTEM", "PIPE", "FATAL", String(err));
    process.exit(1);
  }
}

main();
