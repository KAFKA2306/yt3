
import "dotenv/config";
import { randomUUID } from "crypto";
import { createGraph } from "./graph.js";
import { AgentState } from "./state.js";

async function main() {
    const graph = createGraph();
    const runId = process.env.RUN_ID;
    const bucket = process.argv[2];

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
