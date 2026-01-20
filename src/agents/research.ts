import { AssetStore, ROOT, BaseAgent, parseLlmJson } from "../core.js";
import { NewsItem } from "../types.js";

import { loadMemoryIndex, loadMemoryEssences } from "../agents/memory.js";

export interface ResearchResult { director_data: any; news: NewsItem[]; memory_context: string; }

export class ResearchAgent extends BaseAgent {
    constructor(store: AssetStore) { super(store, "research", { temperature: 0.5 }); }

    async loadMemory(query: string): Promise<{ recent: string; essences: string }> {
        const idx = loadMemoryIndex();
        const ess = loadMemoryEssences();
        const recent = idx.videos.filter((v: any) => (Date.now() - new Date(v.date).getTime()) / 86400000 <= 14);

        let relevant = ess.essences;
        if (ess.essences.length > 5) {
            const candidates = ess.essences.map((e: any) => e.topic).join("\n");
            const selected = await this.runLlm("Select topics relevant to query. Return JSON array of strings.", `Query: ${query}\nCandidates:\n${candidates}`, t => parseLlmJson<string[]>(t), { temperature: 0 }).catch(() => []);
            if (selected.length) relevant = ess.essences.filter((e: any) => (selected as string[]).includes(e.topic));
        }

        return {
            recent: recent.map((v: any) => `- ${v.topic}`).join("\n"),
            essences: relevant.slice(0, 3).map((e: any) => `【${e.topic}】\n${e.key_insights.join("\n")}`).join("\n")
        };
    }

    async run(bucket: string, limit: number = 3): Promise<ResearchResult> {
        this.logInput({ bucket, limit });
        const { recent, essences } = await this.loadMemory(bucket);
        const cfg = this.loadPrompt("research");
        const res = await this.runLlm(cfg.system.replace("{recent_topics}", recent), `${cfg.user_template.replace("{category}", bucket)}\n\n[PAST]\n${essences}`, t => parseLlmJson<any>(t), { extra: { tools: [{ google_search: {} }] } });
        return { director_data: res.director_data, news: res.news, memory_context: essences };
    }
}
