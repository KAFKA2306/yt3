import path from "path";
import fs from "fs-extra";
import yaml from "js-yaml";
import { AssetStore, BaseAgent, ROOT, readYamlFile, parseLlmJson } from "../core.js";
import { AgentState } from "../types.js";

export function loadMemoryIndex(): { videos: Array<{ id: string; date: string; topic: string; angle: string; title: string; keywords: string[] }> } {
    return readYamlFile(path.join(ROOT, "memory", "index.yaml"));
}

export function loadMemoryEssences(): { essences: Array<{ video_id: string; topic: string; key_insights: string[] }> } {
    return readYamlFile(path.join(ROOT, "memory", "essences.yaml"));
}

export class MemoryAgent extends BaseAgent {
    constructor(store: AssetStore) { super(store, "memory", { temperature: 0.2 }); }

    async run(state: AgentState): Promise<void> {
        this.logInput({ run_id: state.run_id, title: state.metadata?.title });

        if (!state.metadata || !state.script) return;

        const indexPath = path.join(ROOT, "memory", "index.yaml");
        const idx = loadMemoryIndex();

        const newEntry = {
            id: state.run_id,
            date: new Date().toISOString().split("T")[0],
            topic: state.director_data?.title_hook || state.metadata!.title,
            angle: state.director_data?.angle || "Standard",
            title: state.metadata!.title,
            keywords: state.metadata!.tags
        };

        idx.videos.push(newEntry);
        fs.writeFileSync(indexPath, yaml.dump(idx));

        const essencesPath = path.join(ROOT, "memory", "essences.yaml");
        const ess = loadMemoryEssences();
        const cfg = this.loadPrompt("memory");
        const scriptText = state.script!.lines.map(l => l.text).join(" ");

        const raw = await this.runLlm<{ key_insights: string[] }>(cfg.system, cfg.user_template.replace("{script_text}", scriptText), text => parseLlmJson(text));
        ess.essences.push({ video_id: state.run_id, topic: state.metadata!.title, ...raw });
        fs.writeFileSync(essencesPath, yaml.dump(ess));
    }
}
