
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { AssetStore } from "../asset.js";
import { ROOT } from "../config.js";
import { BaseAgent } from "./base.js";
import { parseLlmYaml, parseLlmJson } from "../utils.js";
import { NewsItem, Script, ScriptLine } from "../models.js";

interface Essence {
    video_id: string;
    topic: string;
    key_insights: string[];
    data_points: string[];
}

export interface ContentResult {
    script: Script;
    metadata: any;
}

export class ContentAgent extends BaseAgent {
    essencesPath: string;

    constructor(store: AssetStore) {
        super(store, "content", { temperature: 0.7 });
        this.essencesPath = path.join(ROOT, "memory", "essences.yaml");
    }

    loadEssences(): Essence[] {
        if (!fs.existsSync(this.essencesPath)) return [];
        const file = fs.readFileSync(this.essencesPath, "utf8");
        const data = yaml.load(file) as any;
        return data?.essences || [];
    }

    formatEssences(topic: string): string {
        const essences = this.loadEssences().slice(0, 3);
        if (essences.length === 0) return "なし";

        return essences.map(e => `
【${e.topic}】
${e.key_insights.slice(0, 2).map(i => `- ${i}`).join("\n")}
${e.data_points.slice(0, 2).map(d => `- ${d}`).join("\n")}
`).join("\n");
    }

    async runScript(news: NewsItem[], directorData: any): Promise<Script> {
        const essences = this.formatEssences(directorData?.title_hook || "");
        const cfg = this.loadPrompt("script");
        const newsStr = JSON.stringify(news, null, 2);

        const user = `${cfg.user_template.replace("{news_items}", newsStr)}

[戦略] ${directorData.angle || "Default"}
[過去の知識] ${essences}`;

        return this.runLlm(cfg.system, user, (text) => {
            const data = parseLlmYaml<any>(text) || {};
            const lines: ScriptLine[] = (data.segments || []).map((seg: any) => ({
                speaker: seg.speaker, text: seg.text, duration: 0.0,
            }));
            return {
                title: data.title || news[0]?.title || "News",
                description: data.description || "",
                lines, total_duration: 0.0,
            };
        });
    }

    async runMetadata(news: NewsItem[], script: Script): Promise<any> {
        const cfg = this.loadPrompt("metadata");
        const newsItems = news.map(n => `- ${n.title}`).join("\n");
        const scriptExcerpt = script.lines.slice(0, 5).map(l => `${l.speaker}: ${l.text}`).join("\n");

        const user = cfg.user_template
            .replace("{news_items}", newsItems)
            .replace("{script_excerpt}", scriptExcerpt);

        return this.runLlm(cfg.system, user, (text) => parseLlmJson<any>(text), { temperature: 0.3 });
    }

    async run(news: NewsItem[], directorData: any): Promise<ContentResult> {
        this.logInput({ news_count: news.length, angle: directorData?.angle });

        const script = await this.runScript(news, directorData);
        const metadata = await this.runMetadata(news, script);

        return { script, metadata };
    }
}
