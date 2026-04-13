import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import type { AgentState, AppConfig } from "../../domain/types.js";
import { RunStage } from "../../domain/types.js";
import { ROOT, loadConfig } from "../base.js";

export class AssetStore {
	runDir: string;
	cfg: AppConfig;

	constructor(runId: string) {
		this.cfg = loadConfig() as AppConfig;
		this.runDir = path.join(ROOT, this.cfg.workflow.paths.runs_dir, runId);
		fs.ensureDirSync(this.runDir);
	}

	loadState(): Partial<AgentState> {
		let state: Partial<AgentState> = {};
		const p = path.join(this.runDir, this.cfg.workflow.filenames.state);
		if (fs.existsSync(p)) state = fs.readJsonSync(p);
		for (const s of [
			RunStage.RESEARCH,
			RunStage.CONTENT,
			RunStage.MEDIA,
			RunStage.MEMORY,
		]) {
			const op = path.join(this.runDir, s, this.cfg.workflow.filenames.output);
			if (fs.existsSync(op))
				Object.assign(state, yaml.load(fs.readFileSync(op, "utf-8")));
		}
		return state;
	}

	updateState(patches: Partial<AgentState>) {
		const p = path.join(this.runDir, this.cfg.workflow.filenames.state);
		fs.writeJsonSync(p, { ...this.loadState(), ...patches }, { spaces: 2 });
	}

	load<T>(stage: string, type: "input" | "output" | "prompt"): T | null {
		const f =
			type === "input"
				? (this.cfg.workflow.filenames as Record<string, string>).input ||
					"input.yaml"
				: type === "output"
					? this.cfg.workflow.filenames.output
					: `${stage}_prompt.yaml`;
		const p = path.join(this.runDir, stage, f);
		if (!fs.existsSync(p)) return null;
		return (
			p.endsWith(".json")
				? fs.readJsonSync(p)
				: yaml.load(fs.readFileSync(p, "utf-8"))
		) as T;
	}

	save(stage: string, type: "input" | "output", data: unknown) {
		const f =
			type === "input"
				? (this.cfg.workflow.filenames as Record<string, string>).input ||
					"input.yaml"
				: this.cfg.workflow.filenames.output;
		const p = path.join(this.runDir, stage, f);
		fs.ensureDirSync(path.dirname(p));
		if (f.endsWith(".json")) fs.writeJsonSync(p, data, { spaces: 2 });
		else fs.writeFileSync(p, yaml.dump(data));
	}

	audioDir() {
		return this.ensure("media/audio");
	}
	videoDir() {
		return this.ensure("media/video");
	}
	private ensure(sub: string) {
		const p = path.join(this.runDir, sub);
		fs.ensureDirSync(p);
		return p;
	}
}
