import path from "path";
import fs from "fs-extra";
import { AssetStore, ROOT } from "./core.js";
import { createGraph } from "./graph.js";
import { AgentState } from "./types.js";
import { ResearchAgent } from "./agents/research.js";
import { ContentAgent } from "./agents/content.js";
import { MediaAgent } from "./agents/media.js";
import { PublishAgent } from "./agents/publish.js";

async function main() {
    const [step, runIdArg] = process.argv.slice(2);
    let runId = runIdArg || new Date().toISOString().split("T")[0];

    if (runId === "latest") {
        const d = path.join(ROOT, "runs");
        const dirs = fs.readdirSync(d).map(n => ({ n, p: path.join(d, n) })).filter(d => fs.statSync(d.p).isDirectory()).sort((a, b) => fs.statSync(b.p).mtimeMs - fs.statSync(a.p).mtimeMs);
        runId = dirs[0].n;
    }

    const store = new AssetStore(runId);
    const state = store.loadState();

    if (step === "all") {
        await createGraph(store).invoke({ run_id: runId, bucket: state.bucket });
        return;
    }

    const agents = {
        research: new ResearchAgent(store),
        content: new ContentAgent(store),
        media: new MediaAgent(store),
        publish: new PublishAgent(store)
    };
    const stepName = step as keyof typeof agents;
    const agent = agents[stepName];
    if (!agent) throw new Error(`Unknown step: ${step}`);

    let res: Partial<AgentState> = {};
    if (step === "research") res = await agents.research.run(state.bucket || "macro_economy", state.limit || 3);
    if (step === "content") res = await agents.content.run(state.news || [], state.director_data!, state.memory_context || "");
    if (step === "media") {
        const script = state.script!;
        const mediaRes = await agents.media.run(script, state.metadata?.thumbnail_title || script.title);
        res = { audio_paths: mediaRes.audio_paths, thumbnail_path: mediaRes.thumbnail_path, video_path: mediaRes.video_path };
    }
    if (step === "publish") res = { publish_results: await agents.publish.run(state as AgentState) };

    store.updateState(res);
}

main().catch(e => { console.error(e); process.exit(1); });
