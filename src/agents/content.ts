import { AssetStore, BaseAgent, parseLlmYaml } from "../core.js";
import { DirectorData, Metadata, NewsItem, Script } from "../types.js";

export interface ContentResult { script: Script; metadata: Metadata; }

export class ContentAgent extends BaseAgent {
    constructor(store: AssetStore) { super(store, "content", { temperature: 0.7 }); }

    async run(news: NewsItem[], director: DirectorData, context: string): Promise<ContentResult> {
        this.logInput({ news_count: news.length, angle: director.angle });
        const cfg = this.loadPrompt("content");
        const user = `${cfg.user_template}\n\n[NEWS]\n${JSON.stringify(news)}\n\n[STRATEGY]\n${director.angle}\n\n[PAST]\n${context}`;

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
