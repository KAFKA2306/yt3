import path from "path";
import { AssetStore, ROOT, BaseAgent, parseLlmJson, loadConfig, readYamlFile } from "../core.js";
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
        const cfg = readYamlFile<{
            selection: { system: string; user_template: string };
            deep_dive: { system: string; user_template: string }
        }>(path.join(ROOT, "prompts", "research_v2.yaml"));

        // Stage 1: Trend Search (Proactive)
        const trends = await this.runLlm<string>(
            "You are a news aggregator. Use the google_search tool to find the latest significant news and trends. Return a bulleted list of 5-10 top headlines with brief summaries.",
            `Find the latest significant news in "${bucket}" from the last 24-48 hours.`,
            t => t, // Return raw text
            { extra: { tools: [{ google_search: {} }] } }
        );

        // Stage 2: Selection & Deduplication
        const selection = await this.runLlm<{ selected_topic: string; reason: string; search_query: string }>(
            cfg.selection.system,
            cfg.selection.user_template.replace("{category}", bucket).replace("{recent_topics}", recent).replace("{trends}", trends),
            t => parseLlmJson(t),
            { temperature: 0.2 }
        );

        // Stage 3: Deep Dive
        const deepDive = await this.runLlm<ResearchLlmResponse>(
            cfg.deep_dive.system.replace("{topic}", selection.selected_topic),
            cfg.deep_dive.user_template.replace("{topic}", selection.selected_topic).replace("{reason}", selection.reason),
            t => parseLlmJson(t),
            { extra: { tools: [{ google_search: {} }] } }
        );

        const { director_data, news } = deepDive;
        return {
            director_data: {
                angle: director_data.angle,
                title_hook: director_data.title_hook,
                search_query: director_data.search_query || selection.search_query,
                key_questions: director_data.key_questions
            },
            news: news.filter((n: NewsItem) => n && n.title),
            memory_context: essences
        };
    }
}
