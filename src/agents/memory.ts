import path from "node:path";
import fs from "fs-extra";
import { type AssetStore, BaseAgent, ROOT } from "../core.js";
import type { AgentState } from "../types.js";

export class MemoryAgent extends BaseAgent {
  constructor(store: AssetStore) {
    super(store, "memory");
  }

  async run(state: AgentState): Promise<void> {
    this.logInput(state);
    const cfg = this.config.workflow.memory;
    const memPath = path.isAbsolute(cfg.index_file)
      ? path.dirname(cfg.index_file)
      : path.join(ROOT, "memory");
    const idxPath = path.join(memPath, "index.json");
    const essPath = path.join(memPath, "essences.json");

    const index = fs.existsSync(idxPath) ? fs.readJsonSync(idxPath) : { videos: [] };
    index.videos.push({
      run_id: state.run_id,
      topic: state.metadata?.title || state.evaluation?.essence?.topic || "Unknown",
      date: new Date().toISOString(),
      url: state.publish_results?.youtube?.video_id
        ? `https://youtube.com/watch?v=${state.publish_results.youtube.video_id}`
        : "",
    });
    fs.ensureDirSync(memPath);
    fs.writeJsonSync(idxPath, index, { spaces: 2 });

    if (state.evaluation?.essence) {
      const ess = fs.existsSync(essPath) ? fs.readJsonSync(essPath) : { essences: [] };
      ess.essences.push(state.evaluation.essence);
      fs.writeJsonSync(essPath, ess, { spaces: 2 });
    }

    this.logOutput({ status: "updated", index_size: index.videos.length });
  }
}
