import { AssetStore, ROOT, BaseAgent, parseLlmJson, loadConfig } from "../core.js";
import { DirectorData, NewsItem } from "../types.js";

import { loadMemoryIndex, loadMemoryEssences } from "../agents/memory.js";

export interface ResearchResult { director_data: DirectorData; news: NewsItem[]; memory_context: string; }

interface ResearchLlmResponse {
    director_data: {
        angle: string;
        topic: string;
        title_hook: string;
        search_query: string;
        key_questions: string[];
    };
    news: NewsItem[];
}

export class ResearchAgent extends BaseAgent {
    constructor(store: AssetStore) { super(store, "research", { temperature: 0.5 }); }

    async loadMemory(query: string): Promise<{ recent: string; essences: string }> {
        const cfg = loadConfig().steps.research!;
        const idx = loadMemoryIndex();
        const ess = loadMemoryEssences();
        const recent = idx.videos.filter((v: { topic: string; date: string }) => (Date.now() - new Date(v.date).getTime()) / 86400000 <= cfg.recent_days);

        let relevant = ess.essences;
        if (ess.essences.length > 5) {
            const candidates = ess.essences.map((e: { topic: string }) => e.topic).join("\n");
            const selected = await this.runLlm("Select topics relevant to query. Return JSON array of strings.", `Query: ${query}\nCandidates:\n${candidates}`, t => parseLlmJson<string[]>(t), { temperature: 0 }).catch((): string[] => []);
            if (selected.length) relevant = ess.essences.filter((e: { topic: string }) => (selected as string[]).includes(e.topic));
        }

        return {
            recent: recent.map((v: { topic: string }) => `- ${v.topic}`).join("\n"),
            essences: relevant.slice(0, cfg.essence_limit).map((e: { topic: string; key_insights: string[] }) => `【${e.topic}】\n${e.key_insights.join("\n")}`).join("\n")
        };
    }

    async run(bucket: string, limit: number = 3): Promise<ResearchResult> {
        this.logInput({ bucket, limit });
        const { recent, essences } = await this.loadMemory(bucket);
        const cfg = this.loadPrompt("research");
        const raw = await this.runLlm<ResearchLlmResponse>(
            cfg.system.replace("{knowledge_base}", essences),
            `${cfg.user_template.replace("{category}", bucket)}`,
            t => parseLlmJson(t),
            { extra: { tools: [{ google_search: {} }] } }
        );
        const { director_data, news } = raw;
        return {
            director_data: {
                angle: director_data.angle,
                title_hook: director_data.title_hook,
                search_query: director_data.search_query,
                key_questions: director_data.key_questions
            },
            news: news.filter((n: NewsItem) => n && n.title),
            memory_context: essences
        };
    }
}
