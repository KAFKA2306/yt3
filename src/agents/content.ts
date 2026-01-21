import { AssetStore, BaseAgent, parseLlmYaml } from "../core.js";
import { DirectorData, Metadata, NewsItem, Script } from "../types.js";

export interface ContentResult { script: Script; metadata: Metadata; }

export class ContentAgent extends BaseAgent {
    constructor(store: AssetStore) { super(store, "content", { temperature: 0.4 }); }

    async run(news: NewsItem[], director: DirectorData, context: string): Promise<ContentResult> {
        this.logInput({ news, director, context });
        const cfg = this.loadPrompt("content");

        // Format news with URLs explicitly to help the LLM cite sources
        const formattedNews = news.map(n => `Title: ${n.title}\nSource: ${n.url}\nSummary: ${n.summary}\nSnippet: ${n.snippet || "No snippet"}`).join("\n\n");
        const user = cfg.user_template.replace("{news_items}", formattedNews).replace("{strategy}", director.angle);

        return this.runLlm(cfg.system, user, text => {
            const data = parseLlmYaml<any>(text);
            const script = data.script || data;
            const metadata = data.metadata || data;

            if (!script.title || !script.segments) {
                console.error("Invalid LLM response for content:", data);
                throw new Error("Missing script title or segments in LLM response");
            }

            return {
                script: {
                    title: script.title,
                    description: script.description || "",
                    lines: script.segments.map((s: any) => ({ speaker: s.speaker, text: s.text, duration: 0 })),
                    total_duration: 0
                },
                metadata: {
                    title: metadata.title || "",
                    thumbnail_title: metadata.thumbnail_title || "",
                    description: metadata.description || "",
                    tags: metadata.tags || []
                }
            };
        });
    }
}
