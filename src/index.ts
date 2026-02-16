import "dotenv/config";
import { AssetStore, loadConfig } from "./core.js";
import { createGraph } from "./graph.js";
import { AgentLogger } from "./utils/logger.js";

async function main() {
    const runId = process.env.RUN_ID || `run_${Date.now()}`;
    const store = new AssetStore(runId);
    const cfg = loadConfig();

    AgentLogger.init();
    AgentLogger.info("SYSTEM", "MAIN", "START", `Starting YouTuber Pipeline (RunID: ${runId})`);

    const graph = createGraph(store);
    const initialState = {
        ...store.loadState(),
        run_id: runId,
        bucket: process.env.BUCKET || "macro_economy",
        limit: parseInt(process.env.LIMIT || "3"),
        status: "starting"
    };

    const finalState = await graph.invoke(initialState);
    AgentLogger.info("SYSTEM", "MAIN", "SUCCESS", `Pipeline finished with status: ${finalState.status}`);
}

main();
