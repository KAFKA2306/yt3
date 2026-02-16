import path from "path";
import fs from "fs-extra";
import { AssetStore, ROOT, loadConfig } from "./core.js";
import { createGraph } from "./graph.js";
import { AgentState } from "./types.js";
import { TrendScout } from "./agents/research.js";
import { ScriptSmith } from "./agents/content.js";
import { VisualDirector } from "./agents/media.js";
import { PublishAgent } from "./agents/publish.js";
import { CriticAgent } from "./agents/critic.js";
import { sendAlert } from "./utils/discord.js";

const MAX_CONTENT_RETRIES = 3;

const cfg = loadConfig();
const MAX_RETRIES = cfg.defaults?.retries || 3;

function resolveRunId(arg?: string): string {
    if (!arg || arg === "latest") {
        const d = path.join(ROOT, "runs");
        const dirs = fs.readdirSync(d).map(n => ({ n, p: path.join(d, n) })).filter(d => fs.statSync(d.p).isDirectory()).sort((a, b) => fs.statSync(b.p).mtimeMs - fs.statSync(a.p).mtimeMs);
        return dirs[0]?.n || new Date().toISOString().split("T")[0];
    }
    return arg;
}

async function runStep(step: string, bucket: string, store: AssetStore, state: Partial<AgentState>): Promise<Partial<AgentState>> {
    const agents: Record<string, () => Promise<Partial<AgentState>>> = {
        research: () => new TrendScout(store).run(bucket || state.bucket || "global_macro", state.limit || 3),
        content: () => new ScriptSmith(store).run(state.news || [], state.director_data!, state.memory_context || ""),
        "content:fix": async () => {
            if (!state.evaluation) throw new Error("No evaluation report");
            if ((state.retries || 0) >= MAX_RETRIES) throw new Error(`Max retries (${MAX_RETRIES})`);
            const res = await new ScriptSmith(store).run(state.news || [], state.director_data!, state.memory_context || "", state.evaluation);
            return { ...res, retries: (state.retries || 0) + 1 };
        },
        evaluate: async () => ({ evaluation: await new CriticAgent(store).run(state.script!) }),
        media: async () => {
            const res = await new VisualDirector(store).run(state.script!, state.metadata?.thumbnail_title || state.script!.title);
            return { audio_paths: res.audio_paths, thumbnail_path: res.thumbnail_path, video_path: res.video_path };
        },
        publish: async () => ({ publish_results: await new PublishAgent(store).run(state as AgentState) }),
        all: async () => {
            await createGraph(store).invoke({ run_id: store.runDir.split("/").pop(), bucket: state.bucket || bucket });
            await sendAlert(`Workflow finished: ${state.bucket}`, "success");
            return {};
        }
    };
    const fn = agents[step];
    if (!fn) throw new Error(`Unknown step: ${step}`);
    return fn();
}

async function main() {
    const [step, runIdArg, bucketArg] = process.argv.slice(2);
    const store = new AssetStore(resolveRunId(runIdArg));
    const res = await runStep(step, bucketArg, store, store.loadState());
    if (res) store.updateState(res);
}

main();
