import path from "path";
import fs from "fs-extra";
import { AssetStore, ROOT, BaseAgent, parseLlmJson, loadConfig, readYamlFile } from "../core.js";
import { AppConfig, DirectorData, NewsItem } from "../types.js";
import { loadMemoryIndex, loadMemoryEssences } from "../agents/memory.js";

export interface ResearchResult { director_data: DirectorData; news: NewsItem[]; memory_context: string; }

interface TrendConfig {
    trend_scout: { system: string; user_template: string };
    editor_selection: { system: string; user_template: string };
    deep_dive: { system: string; user_template: string };
}

interface EditorSelection {
    selected_topic: string;
    reason: string;
    search_query: string;
    angle: string;
}

interface ResearchLlmResponse {
    director_data: {
        angle: string;
        title_hook: string;
        key_questions: string[];
    };
    news: NewsItem[];
}

export class TrendScout extends BaseAgent {
    constructor(store: AssetStore) { super(store, "research", { temperature: 0.5 }); }

    async loadMemory(query: string): Promise<{ recent: string; essences: string }> {
        const cfg = loadConfig().steps.research!;
        const idx = loadMemoryIndex();
        const ess = loadMemoryEssences();
        const recent = idx.videos.filter((v: { topic: string; date: string }) => (Date.now() - new Date(v.date).getTime()) / 86400000 <= cfg.recent_days);

        let relevant = ess.essences;
        if (ess.essences.length > 5) {
            const candidates = ess.essences.map((e: { topic: string }) => e.topic).join("\n");
            const selected = await this.runLlm("Select topics relevant to query. Return JSON array of strings.", `Query: ${query}\nCandidates:\n${candidates}`, t => parseLlmJson<string[]>(t), { temperature: 0 });
            if (Array.isArray(selected) && selected.length) {
                relevant = ess.essences.filter((e: { topic: string }) => selected.includes(e.topic));
            }
        }

        return {
            recent: recent.map((v: { topic: string }) => `- ${v.topic}`).join("\n"),
            essences: relevant.slice(0, cfg.essence_limit).map((e: { topic: string; key_insights: string[] }) => `【${e.topic}】\n${e.key_insights.join("\n")}`).join("\n")
        };
    }

    async run(bucket: string, limit: number = 3): Promise<ResearchResult> {
        const outputPath = path.join(this.store.runDir, "research", "output.yaml");
        if (fs.existsSync(outputPath)) {
            // @ts-ignore
            return readYamlFile<ResearchResult>(outputPath);
        }

        this.logInput({ bucket, limit });
        const { recent, essences } = await this.loadMemory("Global Trends");
        const appCfg = loadConfig();
        const researchCfg = appCfg.steps.research!;
        const promptCfg = this.loadPrompt<TrendConfig>("research");

        const trendReports = await this.gatherTrendReports(researchCfg, promptCfg);
        const combinedTrends = trendReports.join("\n\n");
        if (!combinedTrends) throw new Error("Global Trend Scout failed to find any news.");

        const selection = await this.runLlm<EditorSelection>(
            promptCfg.editor_selection.system,
            promptCfg.editor_selection.user_template.replace("{trends}", combinedTrends).replace("{recent_topics}", recent),
            t => parseLlmJson(t),
            { temperature: 0.4 }
        );

        const validResults = await this.performDeepDives(selection, researchCfg, promptCfg);
        if (validResults.length === 0) throw new Error("Deep dive failed to return any valid news.");

        return {
            director_data: {
                angle: selection.angle,
                title_hook: validResults[0]?.director_data.title_hook || selection.selected_topic,
                search_query: selection.search_query,
                key_questions: validResults.flatMap(r => r.director_data.key_questions).slice(0, 5)
            },
            news: validResults.flatMap(r => r.news).filter(n => n && n.title),
            memory_context: essences
        };
    }

    private async gatherTrendReports(cfg: NonNullable<AppConfig["steps"]["research"]>, prompt: TrendConfig): Promise<string[]> {
        const reports: string[] = [];
        for (let i = 0; i < cfg.regions.length; i++) {
            const region = cfg.regions[i];
            if (i > 0) await new Promise(r => setTimeout(r, cfg.request_cooldown_ms || 30000));
            const report = await this.runLlm<string>(
                prompt.trend_scout.system.replace("{language}", region.lang),
                prompt.trend_scout.user_template.replace("{language}", region.lang),
                t => t,
                { extra: { tools: [{ google_search: {} }] } }
            );
            if (report) reports.push(`### Report from ${region.lang}\n${report}`);
        }
        return reports;
    }

    private async performDeepDives(sel: EditorSelection, cfg: NonNullable<AppConfig["steps"]["research"]>, prompt: TrendConfig): Promise<ResearchLlmResponse[]> {
        const results = await Promise.all(cfg.angles.map(async (angle: { name: string; lang: string }) => {
            return this.runLlm<ResearchLlmResponse>(
                prompt.deep_dive.system.replace("{topic}", sel.selected_topic).replace("{angle}", sel.angle),
                prompt.deep_dive.user_template.replace("{topic}", sel.selected_topic).replace("{reason}", sel.reason).replace("{angle}", angle.name) + `\n\n[Search Scope]: ${angle.lang} sources.`,
                t => parseLlmJson(t),
                { extra: { tools: [{ google_search: {} }] } }
            );
        }));
        return results.filter((r: ResearchLlmResponse | null): r is ResearchLlmResponse => r !== null);
    }
}
