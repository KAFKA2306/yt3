import { AssetStore, BaseAgent, parseLlmJson, loadConfig } from "../core.js";
import { EvaluationReport, Script } from "../types.js";

export class CriticAgent extends BaseAgent {
    constructor(store: AssetStore) {
        const cfg = loadConfig();
        super(store, "critic", { temperature: cfg.providers.llm.gemini.temperature || 0.7 });
    }

    async run(script: Script): Promise<EvaluationReport> {
        this.logInput(script);
        const prompts = this.loadPrompt<{ system: string; user_template: string; rubric: string }>("critic");
        const res = await this.runLlm<EvaluationReport>(
            prompts.system,
            prompts.user_template
                .replace("{script}", JSON.stringify(script, null, 2))
                .replace("{rubric}", prompts.rubric || ""),
            text => parseLlmJson(text)
        );
        this.logOutput(res);
        return res;
    }
}
