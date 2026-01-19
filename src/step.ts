import "dotenv/config";
import fs from "fs-extra";
import path from "path";
import { AssetStore } from "./asset.js";
import { DirectorAgent } from "./agents/director.js";
import { ReporterAgent } from "./agents/reporter.js";
import { ScriptAgent } from "./agents/script.js";
import { AudioAgent } from "./agents/audio.js";
import { VideoAgent } from "./agents/video.js";
import { AgentState } from "./state.js";
import { ROOT } from "./config.js";
import { randomUUID } from "crypto";

const args = process.argv.slice(2);
const stepName = args[0];
let runId = args[1];
const bucketArg = args[2] || "General";

if (!stepName) {
    console.error("Usage: npx tsx src/step.ts <step> <run_id|latest|new> [bucket]");
    console.error("Steps: director, reporter, script, audio, video");
    process.exit(1);
}

const runsDir = path.join(ROOT, "runs");

async function getLatestRunId(): Promise<string | null> {
    if (!fs.existsSync(runsDir)) return null;
    const entries = await fs.readdir(runsDir);
    const runDirs = await Promise.all(entries.map(async (e) => {
        const p = path.join(runsDir, e);
        const stat = await fs.stat(p);
        return { name: e, time: stat.mtimeMs, isDir: stat.isDirectory() };
    }));
    const sorted = runDirs.filter(r => r.isDir).sort((a, b) => b.time - a.time);
    return sorted.length > 0 ? sorted[0].name : null;
}

(async () => {
    if (runId === "latest") {
        const latest = await getLatestRunId();
        if (!latest) {
            console.error("No runs found.");
            process.exit(1);
        }
        runId = latest;
        console.log(`Using latest run: ${runId}`);
    } else if (runId === "new" || !runId) {
        if (stepName !== "director") {
            if (!runId) {
                const latest = await getLatestRunId();
                if (latest) {
                    runId = latest;
                    console.log(`Using latest run: ${runId}`);
                } else {
                    runId = randomUUID().slice(0, 8);
                    console.log(`Creating new run: ${runId}`);
                }
            } else {
                runId = randomUUID().slice(0, 8);
                console.log(`Creating new run: ${runId}`);
            }
        } else {
            runId = randomUUID().slice(0, 8);
            console.log(`Creating new run: ${runId}`);
        }
    }

    const runDir = path.join(runsDir, runId);
    const statePath = path.join(runDir, "state.json");

    let state: AgentState;
    if (await fs.pathExists(statePath)) {
        state = await fs.readJson(statePath);
        state.run_id = runId;
    } else {
        state = {
            run_id: runId,
            bucket: bucketArg,
            limit: 3
        };
    }

    if (args[2]) {
        state.bucket = bucketArg;
    }

    console.log(`Running step: ${stepName} [RunID: ${runId}] [Bucket: ${state.bucket}]`);
    const store = new AssetStore(state.run_id);

    try {
        switch (stepName) {
            case "director": {
                const agent = new DirectorAgent(store);
                const result = await agent.run(state.bucket);
                state.director_data = result;
                if (result.search_query) {
                    state.bucket = result.search_query;
                }
                break;
            }
            case "reporter": {
                const agent = new ReporterAgent(store);
                const query = state.bucket;
                const items = await agent.run(query, state.limit || 3);
                state.news = items;
                break;
            }
            case "script": {
                const agent = new ScriptAgent(store);
                const script = await agent.run(
                    state.news || [],
                    state.director_data || {},
                    state.knowledge_context || {}
                );
                state.script = script;
                break;
            }
            case "audio": {
                const agent = new AudioAgent(store);
                if (!state.script) throw new Error("No script generated in state");
                const paths = await agent.run(state.script);
                state.audio_paths = paths;
                break;
            }
            case "video": {
                const agent = new VideoAgent(store);
                if (!state.audio_paths) throw new Error("No audio paths generated in state");
                const path = await agent.run(state.audio_paths);
                state.video_path = path;
                state.status = "completed";
                break;
            }
            default:
                throw new Error(`Unknown step: ${stepName}`);
        }

        await fs.ensureDir(runDir);
        await fs.writeJson(statePath, state, { spaces: 2 });
        console.log(`Step ${stepName} completed.`);
        console.log(`State saved to ${statePath}`);

    } catch (error) {
        console.error(`Error executing step ${stepName}:`, error);
        process.exit(1);
    }
})();
