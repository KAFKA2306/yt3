import path from "path";
import fs from "fs-extra";
import { AssetStore, ROOT } from "./core.js";
import { createGraph } from "./graph.js";
import { ResearchAgent } from "./agents/research.js";
import { ContentAgent } from "./agents/content.js";
import { MediaAgent } from "./agents/media.js";
import { PublishAgent } from "./agents/publish.js";

async function main() {
    const [step, runIdArg] = process.argv.slice(2);
    let runId = runIdArg || new Date().toISOString().split("T")[0];

    if (runId === "latest") {
        const dirs = fs.readdirSync(path.join(ROOT, "runs")).map(n => ({ n, p: path.join(ROOT, "runs", n) })).filter(d => fs.statSync(d.p).isDirectory()).sort((a, b) => fs.statSync(b.p).mtimeMs - fs.statSync(a.p).mtimeMs);
        runId = dirs[0].n;
    }

    const store = new AssetStore(runId);
    const state = store.loadState();

    if (step === "all") {
        await createGraph(store).invoke({ run_id: runId, bucket: state.bucket });
        return;
    }

    const agents: any = { research: new ResearchAgent(store), content: new ContentAgent(store), media: new MediaAgent(store), publish: new PublishAgent(store) };
    const agent = agents[step];

    let res: any;
    if (step === "research") res = await agent.run(state.bucket, state.limit);
    if (step === "content") res = await agent.run(state.news, state.director_data, state.memory_context);
    if (step === "media") res = await agent.run(state.script, state.metadata.thumbnail_title);
    if (step === "publish") res = await agent.run(state);

    store.updateState(res);
}

main().catch(console.error);
