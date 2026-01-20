
import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import { AssetStore } from "../asset.js";
import { ROOT } from "../config.js";
import { BaseAgent } from "./base.js";
import { parseLlmJson } from "../utils.js";
import { getRecentTopicsNote, PastVideo } from "../utils/scorer.js";

export class DirectorAgent extends BaseAgent {
    kbPath: string;

    constructor(store: AssetStore) {
        super(store, "director", { temperature: 0.6 });
        this.kbPath = path.join(ROOT, "memory", "knowledge_base.yaml");
    }

    loadKb(): PastVideo[] {
        if (!fs.existsSync(this.kbPath)) return [];
        const file = fs.readFileSync(this.kbPath, "utf8");
        const data = yaml.load(file) as any;
        return data?.videos || [];
    }

    async run(category: string = "General"): Promise<any> {
        this.logInput({ category });

        const pastVideos = this.loadKb();
        const recentTopics = getRecentTopicsNote(pastVideos);

        const cfg = this.loadPrompt("director");
        const system = cfg.system.replace("{recent_topics}", recentTopics);
        const user = cfg.user_template.replace("{category}", category);

        return this.runLlm(system, user, (text) => {
            return parseLlmJson<any>(text);
        });
    }
}
