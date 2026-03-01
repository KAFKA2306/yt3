import path from "node:path";
import fs from "fs-extra";
import { type AssetStore, BaseAgent, ROOT, parseLlmJson } from "../core.js";
import type { AgentState } from "../types.js";

export class MemoryAgent extends BaseAgent {
	constructor(store: AssetStore) {
		super(store, "memory");
	}

	async run(state: AgentState): Promise<void> {
		this.logInput(state);
		const cfg = this.config.workflow.memory;

		// 1. Update Video Index
		const indexFile = path.isAbsolute(cfg.index_file)
			? cfg.index_file
			: path.join(ROOT, cfg.index_file);
		const indexDir = path.dirname(indexFile);
		const index = fs.existsSync(indexFile) ? fs.readJsonSync(indexFile) : { videos: [] };

		index.videos.push({
			run_id: state.run_id,
			topic: state.metadata?.title || state.script?.title || "Unknown",
			date: new Date().toISOString(),
			url: state.publish_results?.youtube?.video_id
				? `https://youtube.com/watch?v=${state.publish_results.youtube.video_id}`
				: "",
		});

		fs.ensureDirSync(indexDir);
		fs.writeJsonSync(indexFile, index, { spaces: 2 });

		// 2. Extract and Update Essences (Knowledge Distillation)
		const scriptLines = state.script?.lines || [];
		if (scriptLines.length > 0) {
			const prompt = this.loadPrompt<{ system: string; user_template: string }>("memory");
			const scriptText = scriptLines.map((l) => `${l.speaker}: ${l.text}`).join("\n");

			try {
				const essence = await this.runLlm(
					prompt.system,
					prompt.user_template.replace("{script_text}", scriptText),
					(text) => parseLlmJson<any>(text),
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
				this.logOutput({ status: "updated", index_size: index.videos.length, essence_added: true });
			} catch (e) {
				this.logOutput({ status: "partial_update", error: (e as Error).message });
			}
		} else {
			this.logOutput({ status: "updated", index_size: index.videos.length, essence_added: false });
		}
	}
}
