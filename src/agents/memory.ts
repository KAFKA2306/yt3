import fs from "fs-extra";
import path from "path";
import { AssetStore, BaseAgent, loadConfig, ROOT } from "../core.js";
import { AgentState } from "../types.js";

export function loadMemoryIndex() {
    const cfg = loadConfig().workflow.memory;
    const p = path.isAbsolute(cfg.index_file) ? cfg.index_file : path.join(ROOT, cfg.index_file);
    if (!fs.existsSync(p)) return { videos: [] };
    return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function loadMemoryEssences() {
    const cfg = loadConfig().workflow.memory;
    const p = path.isAbsolute(cfg.essence_file) ? cfg.essence_file : path.join(ROOT, cfg.essence_file);
    if (!fs.existsSync(p)) return { essences: [] };
    return JSON.parse(fs.readFileSync(p, "utf-8"));
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
