
import path from "path";
import fs from "fs-extra";
import { AssetStore } from "./asset.js";
import { ROOT } from "./config.js";
import { createGraph } from "./graph.js";
import { ResearchAgent } from "./agents/research.js";
import { ContentAgent } from "./agents/content.js";
import { MediaAgent } from "./agents/media.js";
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
        "research": new ResearchAgent(store),
        "content": new ContentAgent(store),
        "media": new MediaAgent(store),
        "publish": new PublishAgent(store)
    };

    const agent = agents[step];
    if (!agent) {
        console.log("Usage: npx tsx src/step.ts [research|content|media|publish|all] [runId]");
        return;
    }

    console.log(`Running step: ${step} [RunID: ${runId}]`);

    let result: any;
    if (step === "research") result = await agent.run(state.bucket, state.limit);
    if (step === "content") result = await agent.run(state.news, state.director_data);
    if (step === "media") result = await agent.run(state.script, state.metadata?.thumbnail_title || state.script?.title);
    if (step === "publish") result = await agent.run(state);

    store.updateState(result);
    console.log(`Step ${step} completed.`);
}

main().catch(console.error);
