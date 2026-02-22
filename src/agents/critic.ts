import { type AssetStore, BaseAgent } from "../core.js";
import type { EvaluationReport, Script } from "../types.js";

export class CriticAgent extends BaseAgent {
  constructor(store: AssetStore) {
    super(store, "critic");
    this.opts["temperature"] = this.config.providers.llm.gemini.temperature || 0.7;
  }

  async run(script: Script): Promise<EvaluationReport> {
    const promptCfg = this.loadPrompt<{ critic: { system: string; user_template: string } }>(
      this.name,
    );
    this.logInput(script);

    const res = await this.runLlm<EvaluationReport>(
      promptCfg.critic.system,
      promptCfg.critic.user_template.replace("{script}", JSON.stringify(script)),
      (t) => JSON.parse(t) as EvaluationReport,
    );

    this.logOutput(res);
    return res;
  }
}
