
import "./config.js"; // Ensure config (and dotenv) is loaded first
import { randomUUID } from "crypto";
import { AssetStore } from "./asset.js";
import { createGraph } from "./graph.js";
import { AgentState } from "./state.js";

async function main() {
    const runId = process.env.RUN_ID || new Date().toISOString().split("T")[0];
    const store = new AssetStore(runId);
    const graph = createGraph(store);
    const bucket = process.argv[2] || "Financial News";

    console.log(`Starting run: ${runId} with bucket: ${bucket}`);

    const inputs = {
        run_id: runId,
        bucket: bucket,
        limit: 3
    };

    const finalState = await graph.invoke(inputs) as unknown as AgentState;

    console.log("Run completed");
    console.log("Video Path:", finalState.video_path);
}

main().catch(console.error);
