import { AssetStore } from "../asset.js";
import { BaseAgent } from "./base.js";
import { parseLlmYaml, parseLlmJson } from "../utils.js";
import { NewsItem, Script, ScriptLine } from "../models.js";

export interface ContentResult {
    script: Script;
    metadata: any;
}

export class ContentAgent extends BaseAgent {
    constructor(store: AssetStore) { super(store, "content", { temperature: 0.7 }); }

    async run(news: NewsItem[], director: any, context: string): Promise<ContentResult> {
        this.logInput({ news_count: news.length, angle: director.angle });
        const cfg = this.loadPrompt("content");
        const user = `${cfg.user_template}\n\n[NEWS]\n${JSON.stringify(news)}\n\n[STRATEGY]\n${director.angle}\n\n[PAST]\n${context}`;

        return this.runLlm(cfg.system, user, text => {
            const data = parseLlmYaml<any>(text);
            const script = {
                title: data.script.title,
                description: data.script.description,
                lines: data.script.segments.map((s: any) => ({ speaker: s.speaker, text: s.text, duration: 0 })),
                total_duration: 0
            };
            return { script, metadata: data.metadata };
        });
    }
}
