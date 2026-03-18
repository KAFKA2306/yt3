import path from "node:path";
import fs from "fs-extra";
import {
	type AssetStore,
	BaseAgent,
	ROOT,
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
		const cfg = this.config.workflow.memory;

		// Extract and Update Essences (Knowledge Distillation)
		const scriptLines = state.script?.lines || [];
		if (scriptLines.length > 0) {
			const prompt = this.loadPrompt<{ system: string; user_template: string }>(
				"memory",
			);
			const scriptText = scriptLines
				.map((l) => `${l.speaker}: ${l.text}`)
				.join("\n");

			const essence = await this.runLlm(
				prompt.system,
				prompt.user_template.replace("{script_text}", scriptText),
				(text) => parseLlmJson<Essence>(text),
			);

			const essenceFile = path.isAbsolute(cfg.essence_file)
				? cfg.essence_file
				: path.join(ROOT, cfg.essence_file);
			const essenceDir = path.dirname(essenceFile);
			const essencesData = fs.existsSync(essenceFile)
				? fs.readJsonSync(essenceFile)
				: { essences: [] };

			essencesData.essences.push({
				run_id: state.run_id,
				topic: state.metadata?.title || state.script?.title || "Unknown",
				timestamp: new Date().toISOString(),
				...essence,
			});

			fs.ensureDirSync(essenceDir);
			fs.writeJsonSync(essenceFile, essencesData, { spaces: 2 });

			// Cleanup: keep only latest 10 essences
			if (essencesData.essences.length > 10) {
				essencesData.essences = essencesData.essences.slice(-10);
				fs.writeJsonSync(essenceFile, essencesData, { spaces: 2 });
			}

			this.logOutput({
				status: "updated",
				essence_added: true,
			});
		} else {
			this.logOutput({
				status: "updated",
				essence_added: false,
			});
		}
	}
}
