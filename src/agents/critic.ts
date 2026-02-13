import path from "path";
import { AssetStore, BaseAgent, parseCriticScore, readYamlFile, ROOT } from "../core.js";
import { Script, EvaluationReport } from "../types.js";

interface CriticConfig {
    personas: { name: string; role: string }[];
    rubric: string;
    system: string;
}

export class CriticAgent extends BaseAgent {
    constructor(store: AssetStore) {
        super(store, "evaluate", { temperature: 0.1 });
    }

    async run(script: Script): Promise<EvaluationReport> {
        this.logInput({ script });

        const cfg = this.loadPrompt<CriticConfig>("critic");
        const personasText = cfg.personas.map(p => `- ${p.name}: ${p.role}`).join("\n");
        const systemPrompt = cfg.system.replace("{personas}", personasText).replace("{rubric}", cfg.rubric);

        const result = await this.runLlm(
            systemPrompt,
            `Evaluate this script:\n\n${JSON.stringify(script, null, 2)}`,
            text => parseCriticScore(text)
        );

        if (result.score < 80) {
            console.error(`[Critic] REJECTED (${result.score}/100) ${result.critique}`);
        } else {
            console.log(`[Critic] PASSED (${result.score}/100)`);
        }

        return result;
    }
}
