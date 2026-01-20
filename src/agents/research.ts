import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { AssetStore } from "../asset.js";
import { ROOT } from "../config.js";
import { BaseAgent } from "./base.js";
import { parseLlmJson } from "../utils.js";
import { NewsItem } from "../models.js";

export interface ResearchResult {
    director_data: any;
    news: NewsItem[];
    memory_context: string;
}

export class ResearchAgent extends BaseAgent {
    constructor(store: AssetStore) { super(store, "research", { temperature: 0.5 }); }

    loadMemory(query: string) {
        const idx = yaml.load(fs.readFileSync(path.join(ROOT, "memory", "index.yaml"), "utf8")) as any;
        const ess = yaml.load(fs.readFileSync(path.join(ROOT, "memory", "essences.yaml"), "utf8")) as any;
        const recent = idx.videos.filter((v: any) => (Date.now() - new Date(v.date).getTime()) / 86400000 <= 14);
        const relevant = ess.essences.filter((e: any) => e.topic.includes(query)).slice(0, 3);
        return {
            recent: recent.map((v: any) => `- ${v.topic}`).join("\n"),
            essences: relevant.map((e: any) => `【${e.topic}】\n${e.key_insights.join("\n")}`).join("\n")
        };
    }

    async run(bucket: string, limit: number = 3): Promise<ResearchResult> {
        this.logInput({ bucket, limit });
        const { recent, essences } = this.loadMemory(bucket);
        const cfg = this.loadPrompt("research");

        const res = await this.runLlm(cfg.system.replace("{recent_topics}", recent), `${cfg.user_template.replace("{category}", bucket)}\n\n[PAST]\n${essences}`, text => parseLlmJson<any>(text), { extra: { tools: [{ google_search: {} }] } });

        return { director_data: res.director_data, news: res.news, memory_context: essences };
    }
}
