import { AssetStore, BaseAgent, parseLlmJson, readYamlFile, ROOT, loadConfig } from "../core.js";
import fs from "fs-extra";
import path from "path";
import { DirectorData, EvaluationReport, Metadata, NewsItem, Script } from "../types.js";

interface Segment {
    speaker: string;
    text: string;
}

export interface ContentResult { script: Script; metadata: Metadata; }

interface PromptSection {
    system: string;
    user_template: string;
}

export class ScriptSmith extends BaseAgent {
    constructor(store: AssetStore) {
        const cfg = loadConfig();
        super(store, "content", { temperature: cfg.providers.llm.content?.temperature || 0.4 });
    }

    async run(news: NewsItem[], director: DirectorData, context: string, evaluation?: EvaluationReport): Promise<ContentResult> {
        const outputPath = path.join(this.store.runDir, "content", "output.yaml");
        if (fs.existsSync(outputPath)) {
            return readYamlFile<ContentResult>(outputPath);
        }

        this.logInput({ news, director, context, evaluation });

        const appCfg = loadConfig();
        const scriptCfg = appCfg.steps.script;
        if (!scriptCfg) throw new Error("Script config missing");
        const contentAndPrompts = this.loadPrompt<{ outline: PromptSection; segment: PromptSection; metadata: PromptSection }>("content");

        const outlineCfg = contentAndPrompts.outline;
        const newsContext = news.map(n =>
            `Title: ${n.title}\nSource: ${n.url}\nSummary: ${n.summary}\nOriginal English Text: ${n.original_english_text || "N/A"}`
        ).join("\n\n");

        const outline = await this.runLlm<{ title: string; sections: { id: number; title: string; key_points: string[]; estimated_duration: number }[] }>(
            outlineCfg.system,
            outlineCfg.user_template.replace("{angle}", director.angle).replace("{news_context}", newsContext),
            text => parseLlmJson(text)
        );

        const segmentCfg = contentAndPrompts.segment;
        let allLines: Segment[] = [];
        let previousContext = "None (Start of video)";

        for (const section of outline.sections) {
            const segmentRes = await this.runLlm<{ lines: Segment[] }>(
                segmentCfg.system,
                segmentCfg.user_template
                    .replace("{angle}", director.angle)
                    .replace("{section_title}", section.title)
                    .replace("{key_points}", section.key_points.join(", "))
                    .replace("{duration}", section.estimated_duration.toString())
                    .replace("{previous_context}", previousContext)
                    .replace("{news_context}", newsContext),
                text => parseLlmJson(text)
            );

            if (segmentRes.lines && segmentRes.lines.length > 0) {
                allLines = allLines.concat(segmentRes.lines);
                const lastLines = segmentRes.lines.slice(-(scriptCfg.context_overlap_lines || 3));
                previousContext = lastLines.map(l => `${l.speaker}: ${l.text}`).join("\n");
            }
            await new Promise(resolve => setTimeout(resolve, scriptCfg.segment_sleep_ms || 15000));
        }

        const scriptText = allLines.map(l => `${l.speaker}: ${l.text}`).join("\n");
        const metadataRes = await this.runLlm<Metadata>(
            contentAndPrompts.metadata.system,
            contentAndPrompts.metadata.user_template
                .replace("{script_text}", scriptText)
                .replace("{news_sources}", newsContext),
            text => parseLlmJson(text)
        );

        const result = {
            script: {
                title: metadataRes.title || outline.title || director.title_hook,
                description: metadataRes.description || director.angle,
                lines: allLines.map(l => ({ speaker: l.speaker, text: l.text, duration: 0 })),
                total_duration: 0
            },
            metadata: {
                title: metadataRes.title || outline.title || director.title_hook,
                thumbnail_title: metadataRes.thumbnail_title || director.title_hook,
                description: metadataRes.description || director.angle,
                tags: metadataRes.tags || appCfg.steps.script?.default_tags || []
            }
        };

        this.logOutput(result);
        return result;
    }
}
