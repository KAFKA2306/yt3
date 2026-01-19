
import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import { AssetStore } from "../asset.js";
import { ROOT } from "../config.js";
import { BaseAgent } from "./base.js";
import { parseLlmJson } from "../utils.js";

export class DirectorAgent extends BaseAgent {
    kbPath: string;

    constructor(store: AssetStore) {
        super(store, "director", { temperature: 0.6 });
        this.kbPath = path.join(ROOT, "memory", "knowledge_base.yaml");
    }

    loadKb(): string {
        if (!fs.existsSync(this.kbPath)) return "No past videos.";
        const file = fs.readFileSync(this.kbPath, "utf8");
        return yaml.dump(yaml.load(file));
    }

    async run(category: string = "General"): Promise<any> {
        this.logInput({ category });
        const kb = this.loadKb();
        const cfg = this.loadPrompt("director");
        const system = cfg.system.replace("{knowledge_base}", kb);
        const user = cfg.user_template.replace("{category}", category);

        return this.runLlm(system, user, (text) => {
            const parsed = parseLlmJson<any>(text);
            return (!parsed || Object.keys(parsed).length === 0) ? {
                topic: category,
                angle: "STRUCTURAL",
                title_hook: category,
                search_query: category,
                key_questions: [],
            } : parsed;
        });
    }
}
