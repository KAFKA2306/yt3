
import { AssetStore } from "../asset.js";
import { BaseAgent } from "./base.js";
import { parseLlmYaml } from "../utils.js";
import { NewsItem, Script, ScriptLine } from "../models.js";

export class ScriptAgent extends BaseAgent {
    constructor(store: AssetStore) {
        super(store, "script", { temperature: 0.8 });
    }

    async run(news: NewsItem[], directorData: any = {}, knowledgeContext: any = {}): Promise<Script> {
        this.logInput({ news, director: directorData, knowledge: knowledgeContext });

        const cfg = this.loadPrompt("script");
        const newsStr = JSON.stringify(news, null, 2);
        let basePrompt = cfg.user_template.replace("{news_items}", newsStr);
        const strategyStr = `Strategy/Angle: ${directorData.angle || "Default"}\nKey Questions: ${directorData.key_questions || []}`;
        const contextStr = `Past References: ${knowledgeContext.past_references || []}`;
        const user = `${basePrompt}\n\n[STRATEGIC INSTRUCTION]\n${strategyStr}\n\n[KNOWLEDGE CONTEXT]\n${contextStr}`;

        return this.runLlm(cfg.system, user, (text) => {
            const data = parseLlmYaml<any>(text) || {};
            const lines: ScriptLine[] = (data.segments || []).map((seg: any) => ({
                speaker: seg.speaker, text: seg.text, duration: 0.0,
            }));
            return {
                title: data.title || (news[0]?.title || "News"),
                description: data.description || "",
                lines: lines,
                total_duration: 0.0,
            };
        });
    }
}
