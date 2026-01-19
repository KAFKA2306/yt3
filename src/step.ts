
import { AssetStore } from "./asset.js";
import { loadConfig } from "./config.js";
import { createGraph } from "./graph.js";
import { ScriptAgent } from "./agents/script.js";
import { AudioAgent } from "./agents/audio.js";
import { VideoAgent } from "./agents/video.js";
import { ThumbnailAgent } from "./agents/thumbnail.js";
import { MetadataAgent } from "./agents/metadata.js";
import { DirectorAgent } from "./agents/director.js";
import { ReporterAgent } from "./agents/reporter.js";

async function main() {
    const args = process.argv.slice(2);
    const step = args[0];
    const runId = args[1] || new Date().toISOString().split("T")[0];
    const store = new AssetStore(runId);
    const state = store.loadState();

    if (step === "all") {
        const graph = createGraph(store);
        await graph.invoke({ run_id: runId, bucket: state.bucket || "Financial News" });
        return;
    }

    const agents: Record<string, any> = {
        "director": new DirectorAgent(store),
        "reporter": new ReporterAgent(store),
        "script": new ScriptAgent(store),
        "metadata": new MetadataAgent(store),
        "audio": new AudioAgent(store),
        "thumbnail": new ThumbnailAgent(store),
        "video": new VideoAgent(store)
    };

    const agent = agents[step];
    if (!agent) {
        console.log("Usage: npx tsx src/step.ts [director|reporter|script|metadata|audio|thumbnail|video|all] [runId]");
        return;
    }

    console.log(`Running step: ${step} [RunID: ${runId}] [Bucket: ${state.bucket}]`);

    let result: any;
    if (step === "director") result = { director_data: await agent.run(state.bucket) };
    if (step === "reporter") result = { news: await agent.run(state.bucket, state.limit) };
    if (step === "script") result = { script: await agent.run(state.news, state.director_data) };
    if (step === "metadata") result = { metadata: await agent.run(state.news, state.script) };
    if (step === "audio") result = { audio_paths: await agent.run(state.script) };
    if (step === "thumbnail") result = { thumbnail_path: await agent.run({ ...state.script, title: state.metadata?.thumbnail_title || state.script.title }) };
    if (step === "video") result = { video_path: await agent.run(state.audio_paths, state.thumbnail_path) };

    store.updateState(result);
    console.log(`Step ${step} completed.`);
    console.log(`State saved to ${store.runDir}/state.json`);
}

main().catch(console.error);
