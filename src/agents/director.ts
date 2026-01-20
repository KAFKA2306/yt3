
import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import { AssetStore } from "../asset.js";
import { ROOT } from "../config.js";
import { BaseAgent } from "./base.js";
import { parseLlmJson } from "../utils.js";

interface VideoEntry {
    id: string;
    date: string;
    topic: string;
    angle: string;
    title: string;
    keywords: string[];
}

export class DirectorAgent extends BaseAgent {
    indexPath: string;

    constructor(store: AssetStore) {
        super(store, "director", { temperature: 0.6 });
        this.indexPath = path.join(ROOT, "memory", "index.yaml");
    }

    loadIndex(): VideoEntry[] {
        if (!fs.existsSync(this.indexPath)) return [];
        const file = fs.readFileSync(this.indexPath, "utf8");
        const data = yaml.load(file) as any;
        return data?.videos || [];
    }

    getRecentTopicsNote(maxDays: number = 14): string {
        const videos = this.loadIndex();
        const now = new Date();

        const recent = videos.filter(v => {
            const daysSince = (now.getTime() - new Date(v.date).getTime()) / (1000 * 60 * 60 * 24);
            return daysSince <= maxDays;
        });

        if (recent.length === 0) return "なし";
        return recent.map(v => `- ${v.topic} (${v.angle})`).join("\n");
    }

    async run(category: string = "General"): Promise<any> {
        this.logInput({ category });

        const recentTopics = this.getRecentTopicsNote();

        const cfg = this.loadPrompt("director");
        const system = cfg.system.replace("{recent_topics}", recentTopics);
        const user = cfg.user_template.replace("{category}", category);

        return this.runLlm(system, user, (text) => {
            return parseLlmJson<any>(text);
        });
    }
}
