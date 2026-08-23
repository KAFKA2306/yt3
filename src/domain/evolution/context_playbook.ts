import path from "node:path";
import fs from "fs-extra";
import { ROOT, loadConfig } from "../../io/core.js";
import type { AppConfig } from "../types.js";
import { type AceBullet, type Playbook, PlaybookSchema } from "./types.js";

export class ContextPlaybook {
	private playbookPath: string;

	constructor(playbookPath?: string) {
		const cfg =
			(globalThis as unknown as Record<string, AppConfig>)._config ||
			loadConfig();
		const aceDir = cfg.workflow.paths.ace_dir || "data/ace";
		this.playbookPath =
			playbookPath || path.join(ROOT, aceDir, "playbook.json");
	}

	load(): Playbook {
		if (!fs.existsSync(this.playbookPath)) return { bullets: [] };
		return PlaybookSchema.parse(fs.readJsonSync(this.playbookPath));
	}

	getRankedBullets(limit = 10): AceBullet[] {
		return this.load()
			.bullets.sort((a, b) => b.confidence - a.confidence)
			.slice(0, limit);
	}
}
