
import path from "path";
import fs from "fs-extra";
import { AssetStore } from "./asset.js";
import { loadConfig, ROOT } from "./config.js";
import { createGraph } from "./graph.js";
import { ScriptAgent } from "./agents/script.js";
import { AudioAgent } from "./agents/audio.js";
import { VideoAgent } from "./agents/video.js";
import { ThumbnailAgent } from "./agents/thumbnail.js";
import { MetadataAgent } from "./agents/metadata.js";
import { DirectorAgent } from "./agents/director.js";
import { ReporterAgent } from "./agents/reporter.js";
import { PublishAgent } from "./agents/publish.js";

async function main() {
    const args = process.argv.slice(2);
    const step = args[0];
    let runId = args[1] || new Date().toISOString().split("T")[0];

    if (runId === "latest") {
        const runsDir = path.join(ROOT, "runs");
        if (fs.existsSync(runsDir)) {
            const dirs = fs.readdirSync(runsDir)
                .map(name => ({ name, path: path.join(runsDir, name) }))
                .filter(d => fs.statSync(d.path).isDirectory())
                .sort((a, b) => fs.statSync(b.path).mtimeMs - fs.statSync(a.path).mtimeMs);

            if (dirs.length > 0) {
                runId = dirs[0].name;
                console.log(`Resolved "latest" to: ${runId}`);
            }
        }
    }

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
        "video": new VideoAgent(store),
        "publish": new PublishAgent(store)
    };

    const agent = agents[step];
    if (!agent) {
        console.log("Usage: npx tsx src/step.ts [director|reporter|script|metadata|audio|thumbnail|video|publish|all] [runId]");
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
    if (step === "publish") result = { publish_results: await agent.run(state) };

    store.updateState(result);
    console.log(`Step ${step} completed.`);
    console.log(`State saved to ${store.runDir}/state.json`);
}

main().catch(console.error);
