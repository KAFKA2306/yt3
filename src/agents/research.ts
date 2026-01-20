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

    async loadMemory(query: string) {
        const idx = yaml.load(fs.readFileSync(path.join(ROOT, "memory", "index.yaml"), "utf8")) as any;
        const ess = yaml.load(fs.readFileSync(path.join(ROOT, "memory", "essences.yaml"), "utf8")) as any;

        const recent = idx.videos.filter((v: any) => (Date.now() - new Date(v.date).getTime()) / 86400000 <= 14);

        // Improved Retrieval: Use LLM if too many items, otherwise take all (up to 10)
        let relevant = ess.essences;
        if (ess.essences.length > 5) {
            try {
                const candidates = ess.essences.map((e: any) => e.topic).join("\n");
                const system = "You are a Knowledge Retriever. Select topics from the list that relevance to the user query. Return JSON array of strings.";
                const user = `Query: ${query}\nCandidates:\n${candidates}`;
                const selectedTopics = await this.runLlm(system, user, text => parseLlmJson<string[]>(text), { temperature: 0.0 });
                relevant = ess.essences.filter((e: any) => selectedTopics.includes(e.topic));
            } catch (e) {
                console.warn("LLM memory retrieval failed, falling back to all.", e);
            }
        }

        // Take top 3 most relevant from the filtered list (or just 3 random if not sorted, but filtered is good enough)
        relevant = relevant.slice(0, 3);

        return {
            recent: recent.map((v: any) => `- ${v.topic}`).join("\n"),
            essences: relevant.map((e: any) => `【${e.topic}】\n${e.key_insights.join("\n")}`).join("\n")
        };
    }

    async run(bucket: string, limit: number = 3): Promise<ResearchResult> {
        this.logInput({ bucket, limit });
        const { recent, essences } = await this.loadMemory(bucket);
        const cfg = this.loadPrompt("research");

        const res = await this.runLlm(cfg.system.replace("{recent_topics}", recent), `${cfg.user_template.replace("{category}", bucket)}\n\n[PAST]\n${essences}`, text => parseLlmJson<any>(text), { extra: { tools: [{ google_search: {} }] } });

        return { director_data: res.director_data, news: res.news, memory_context: essences };
    }
}
