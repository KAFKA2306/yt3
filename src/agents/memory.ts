import fs from "fs-extra";
import path from "path";
import { AssetStore, BaseAgent, loadConfig, ROOT } from "../core.js";
import { AgentState } from "../types.js";

function loadMemoryFile<T>(fileKey: 'index_file' | 'essence_file', fallback: T): T {
    const cfg = loadConfig().workflow.memory;
    const p = path.isAbsolute(cfg[fileKey]) ? cfg[fileKey] : path.join(ROOT, cfg[fileKey]);
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function loadMemoryIndex() {
    return loadMemoryFile<{ videos: { run_id: string; topic: string; date: string; url: string }[] }>("index_file", { videos: [] });
}

export function loadMemoryEssences() {
    return loadMemoryFile<{ essences: { topic: string; key_insights: string[] }[] }>("essence_file", { essences: [] });
}

export class MemoryAgent extends BaseAgent {
    constructor(store: AssetStore) { super(store, "memory"); }

    async run(state: AgentState): Promise<void> {
        this.logInput(state);
        const cfg = loadConfig().workflow.memory;
        const idxPath = path.isAbsolute(cfg.index_file) ? cfg.index_file : path.join(ROOT, cfg.index_file);

        const index = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, "utf-8")) : { videos: [] };
        index.videos.push({
            run_id: state.run_id,
            topic: state.metadata?.title || "Unknown",
            date: new Date().toISOString(),
            url: state.publish_results?.youtube?.video_id ? `https://youtube.com/watch?v=${state.publish_results.youtube.video_id}` : ""
        });

        fs.ensureDirSync(path.dirname(idxPath));
        fs.writeFileSync(idxPath, JSON.stringify(index, null, 2));
        this.logOutput({ status: "updated", index_size: index.videos.length });
    }
}
