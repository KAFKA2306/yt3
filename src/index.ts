import "./core.js";
import { AssetStore, createLlm } from "./core.js";
import { createGraph } from "./graph.js";
import { AgentState } from "./types.js";
import { sendAlert } from "./utils/discord.js";

async function main() {
    const runId = process.env.RUN_ID || new Date().toISOString().split("T")[0];
    const store = new AssetStore(runId);
    const graph = createGraph(store);
    const bucket = process.argv[2] || "Financial News";

    console.log(`Starting: ${runId} (${bucket})`);

    const finalState = await graph.invoke({
        run_id: runId,
        bucket: bucket,
        limit: 3
    }) as unknown as AgentState;

    console.log(`Completed: ${finalState.video_path}`);
    await sendAlert(`Workflow COMPLETED: ${bucket}\nVideo: ${finalState.video_path}`, "success");
}

main();
