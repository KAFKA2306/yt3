import fs from "fs-extra";
import path from "path";
import yaml from "js-yaml";
import { AssetStore } from "../asset.js";
import { ROOT } from "../config.js";
import { BaseAgent } from "./base.js";
import { parseLlmJson } from "../utils.js";

export class MemoryAgent extends BaseAgent {
    constructor(store: AssetStore) { super(store, "memory", { temperature: 0.2 }); }

    async run(state: any): Promise<void> {
        this.logInput({ run_id: state.run_id, title: state.metadata?.title });

        if (!state.metadata || !state.script) {
            console.log("[Memory] Skipping memory update: Missing metadata or script.");
            return;
        }

        // 1. Update Index (Videos)
        const indexPath = path.join(ROOT, "memory", "index.yaml");
        let idx: any = { videos: [] };
        if (fs.existsSync(indexPath)) {
            idx = yaml.load(fs.readFileSync(indexPath, "utf8"));
        }

        const newEntry = {
            id: state.run_id,
            date: new Date().toISOString().split("T")[0], // YYYY-MM-DD
            topic: state.director_data?.title_hook || state.metadata.title,
            angle: state.director_data?.angle || "Standard",
            title: state.metadata.title,
            keywords: state.metadata.tags
        };

        idx.videos.push(newEntry);
        fs.writeFileSync(indexPath, yaml.dump(idx));
        console.log(`[Memory] Updated index with: ${newEntry.title}`);

        // 2. Update Essences
        const essencesPath = path.join(ROOT, "memory", "essences.yaml");
        let ess: any = { essences: [] };
        if (fs.existsSync(essencesPath)) {
            ess = yaml.load(fs.readFileSync(essencesPath, "utf8"));
        }

        const cfg = this.loadPrompt("memory");
        const scriptText = state.script.lines.map((l: any) => l.text).join(" ");

        try {
            const raw = await this.runLlm(cfg.system, cfg.user_template.replace("{script_text}", scriptText), text => parseLlmJson<any>(text));
            const newEssence = {
                video_id: state.run_id,
                topic: state.metadata.title,
                ...raw
            };

            ess.essences.push(newEssence);
            fs.writeFileSync(essencesPath, yaml.dump(ess));
            console.log(`[Memory] Updated essences for: ${newEntry.title}`);
        } catch (e) {
            console.error("[Memory] Failed to extract essence via LLM", e);
        }
    }
}
