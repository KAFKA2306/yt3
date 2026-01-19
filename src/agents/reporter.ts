
import { AssetStore } from "../asset.js";
import { BaseAgent } from "./base.js";
import { parseLlmJson } from "../utils.js";
import { NewsItem } from "../models.js";

export class ReporterAgent extends BaseAgent {
    constructor(store: AssetStore) {
        super(store, "reporter", { extra: { tools: [{ google_search: {} }] } });
    }

    async run(query: string, count: number = 3): Promise<NewsItem[]> {
        this.logInput({ query, count });
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
        });
    }
}
