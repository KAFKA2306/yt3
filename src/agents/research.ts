
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { AssetStore } from "../asset.js";
import { ROOT } from "../config.js";
import { BaseAgent } from "./base.js";
import { parseLlmJson } from "../utils.js";
import { NewsItem } from "../models.js";

interface VideoEntry {
    id: string;
    date: string;
    topic: string;
    angle: string;
    keywords: string[];
}

interface Essence {
    video_id: string;
    topic: string;
    key_insights: string[];
    data_points: string[];
    universal_principles: string[];
}

export interface ResearchResult {
    director_data: any;
    news: NewsItem[];
    memory_context: string;
}

export class ResearchAgent extends BaseAgent {
    indexPath: string;
    essencesPath: string;

    constructor(store: AssetStore) {
        super(store, "research", { temperature: 0.5 });
        this.indexPath = path.join(ROOT, "memory", "index.yaml");
        this.essencesPath = path.join(ROOT, "memory", "essences.yaml");
    }

    // === MEMORY SEARCH ===
    loadIndex(): VideoEntry[] {
        if (!fs.existsSync(this.indexPath)) return [];
        const data = yaml.load(fs.readFileSync(this.indexPath, "utf8")) as any;
        return data?.videos || [];
    }

    loadEssences(): Essence[] {
        if (!fs.existsSync(this.essencesPath)) return [];
        const data = yaml.load(fs.readFileSync(this.essencesPath, "utf8")) as any;
        return data?.essences || [];
    }

    searchMemory(query: string): { recentTopics: string; relevantEssences: string } {
        const videos = this.loadIndex();
        const essences = this.loadEssences();
        const now = new Date();
        const queryLower = query.toLowerCase();

        // Recent topics (14 days)
        const recent = videos.filter(v => {
            const days = (now.getTime() - new Date(v.date).getTime()) / (1000 * 60 * 60 * 24);
            return days <= 14;
        });
        const recentTopics = recent.length > 0
            ? recent.map(v => `- ${v.topic} (${v.angle})`).join("\n")
            : "なし";

        // Relevant essences by keyword matching
        const relevant = essences.filter(e => {
            const eTopic = e.topic.toLowerCase();
            return queryLower.split(" ").some(w => eTopic.includes(w) || e.key_insights.some(i => i.toLowerCase().includes(w)));
        }).slice(0, 3);

        const relevantEssences = relevant.length > 0
            ? relevant.map(e => `【${e.topic}】\n${e.key_insights.slice(0, 2).join("\n")}\n${e.data_points.slice(0, 2).join("\n")}`).join("\n\n")
            : "なし";

        return { recentTopics, relevantEssences };
    }

    // === WEB SEARCH (via LLM with tools) ===
    async webSearch(query: string, count: number): Promise<NewsItem[]> {
        const cfg = this.loadPrompt("reporter");
        const user = cfg.user_template
            .replace("{topic}", query)
            .replace("{count}", count.toString())
            .replace("{recent_topics_note}", "なし");

        return this.runLlm(cfg.system, user, (text) => {
            const parsed = parseLlmJson<any[]>(text);
            return (Array.isArray(parsed) ? parsed : []).map((i: any) => ({
                title: i.title, summary: i.summary, url: i.url,
                published_at: i.published_at || new Date().toISOString()
            }));
        }, { extra: { tools: [{ google_search: {} }] } });
    }

    // === DIRECTOR (angle selection) ===
    async selectAngle(category: string, recentTopics: string, relevantEssences: string): Promise<any> {
        const cfg = this.loadPrompt("director");
        const system = cfg.system.replace("{recent_topics}", recentTopics);
        const user = `${cfg.user_template.replace("{category}", category)}

[過去の蓄積知識]
${relevantEssences}`;

        return this.runLlm(system, user, (text) => parseLlmJson<any>(text));
    }

    // === MAIN RUN ===
    async run(bucket: string, limit: number = 3): Promise<ResearchResult> {
        this.logInput({ bucket, limit });

        // Step 1: Memory search
        console.log("[Research] Searching memory...");
        const { recentTopics, relevantEssences } = this.searchMemory(bucket);
        console.log(`[Research] Found ${recentTopics === "なし" ? 0 : recentTopics.split("\n").length} recent topics`);

        // Step 2: Director (with memory context)
        console.log("[Research] Selecting angle...");
        const director_data = await this.selectAngle(bucket, recentTopics, relevantEssences);

        // Step 3: Web search
        console.log("[Research] Web searching...");
        const searchQuery = director_data?.search_query || bucket;
        const news = await this.webSearch(searchQuery, limit);
        console.log(`[Research] Found ${news.length} news items`);

        return {
            director_data,
            news,
            memory_context: relevantEssences
        };
    }
}
