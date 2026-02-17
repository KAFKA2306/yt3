import { AssetStore, BaseAgent, parseLlmJson, loadConfig, RunStage } from "../core.js";
import fs from "fs-extra";
import path from "path";
import { ContentOutline, ContentResult, ContentSegment, Metadata, NewsItem, Script } from "../types.js";

export class ScriptSmith extends BaseAgent {
    constructor(store: AssetStore) {
        const cfg = loadConfig();
        super(store, RunStage.CONTENT, { temperature: cfg.providers.llm.content?.temperature || 0.4 });
    }

    async run(news: NewsItem[], director: { angle: string; title_hook: string }, context: string): Promise<ContentResult> {
        const outputPath = path.join(this.store.runDir, this.name, this.store.cfg.workflow.filenames.output);
        if (fs.existsSync(outputPath)) {
            return this.store.load<ContentResult>(this.name, this.store.cfg.workflow.filenames.output.replace(".yaml", ""));
        }

        this.logInput({ news, director, context });
        const contentAndPrompts = this.loadPrompt<{ one_shot: { system: string; user_template: string } }>(this.name);

        const newsContext = news.map(n =>
            `Title: ${n.title}\nSource: ${n.url}\nSummary: ${n.summary}`
        ).join("\n\n");

        const res = await this.runLlm<{
            script: { title: string; lines: { speaker: string; text: string }[] };
            metadata: { title: string; thumbnail_title: string; description: string; tags: string[] };
        }>(
            contentAndPrompts.one_shot.system,
            contentAndPrompts.one_shot.user_template
                .replace("{strategy}", director.angle)
                .replace("{news_context}", newsContext)
                .replace("{memory_context}", context),
            text => parseLlmJson(text)
        );

        const result: ContentResult = {
            script: {
                title: res.script.title,
                description: res.metadata.description,
                lines: res.script.lines.map(l => ({ speaker: l.speaker, text: l.text, duration: 0 })),
                total_duration: 0
            },
            metadata: {
                title: res.metadata.title,
                thumbnail_title: res.metadata.thumbnail_title,
                description: res.metadata.description,
                tags: res.metadata.tags
            }
        };

        this.logOutput(result);
        return result;
    }
}
