
import { AssetStore } from "../asset.js";
import { BaseAgent } from "./base.js";
import { parseLlmJson } from "../utils.js";
import { NewsItem, Script } from "../models.js";

export class MetadataAgent extends BaseAgent {
    constructor(store: AssetStore) {
        super(store, "metadata", { temperature: 0.3 });
    }

    async run(news: NewsItem[], script: Script): Promise<any> {
        this.logInput({ news_count: news.length, script_title: script.title });

        const cfg = this.loadPrompt("metadata");
        const newsItems = news.map(n => `- ${n.title}: ${n.summary}`).join("\n");
        const scriptExcerpt = script.lines.slice(0, 10).map(l => `${l.speaker}: ${l.text}`).join("\n");

        const user = cfg.user_template
            .replace("{news_items}", newsItems)
            .replace("{script_excerpt}", scriptExcerpt);

        return this.runLlm(cfg.system, user, (text) => {
            return parseLlmJson<any>(text);
        });
    }
}
