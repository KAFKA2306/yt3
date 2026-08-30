import path from "node:path";
import fs from "fs-extra";
import {
	type AssetStore,
	BaseAgent,
	getMemoryEssenceFile,
	parseLlmJson,
} from "../../io/core.js";
import type { AgentState } from "../types.js";

interface Essence {
	key_insights: string[];
	data_points: string[];
	universal_principles: string[];
	connections: string[];
}

export class MemoryAgent extends BaseAgent {
	constructor(store: AssetStore) {
		super(store, "memory");
	}

	async run(state: AgentState): Promise<void> {
		this.logInput(state);
		const scriptLines = state.script?.lines || [];
		if (scriptLines.length === 0) {
			this.logOutput({ status: "updated", essence_added: false });
			return;
		}

		const prompt = this.loadPrompt<{ system: string; user_template: string }>(
			"memory",
		);
		const scriptText = scriptLines
			.map((line) => `${line.speaker}: ${line.text}`)
			.join("\n");
		const essence = await this.runLlm(
			prompt.system,
			prompt.user_template.replace("{script_text}", scriptText),
			(text) => parseLlmJson<Essence>(text),
		);

		const essenceFile = getMemoryEssenceFile(this.store);
		const essencesData = fs.existsSync(essenceFile)
			? fs.readJsonSync(essenceFile)
			: { essences: [] };
		const newEssence = {
			run_id: state.run_id,
			topic: state.metadata?.title || state.script?.title || "Unknown",
			timestamp: new Date().toISOString(),
			...essence,
		};
		const allEssences = [...essencesData.essences, newEssence];
		fs.ensureDirSync(path.dirname(essenceFile));
		fs.writeJsonSync(
			essenceFile,
			{ ...essencesData, essences: allEssences.slice(-10) },
			{ spaces: 2 },
		);
		this.logOutput({ status: "updated", essence_added: true });
	}
}
