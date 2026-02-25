import path from "node:path";
import fs from "fs-extra";
import { ROOT, loadConfig } from "../core.js";
import { type AceBullet, type Playbook, PlaybookSchema } from "./types.js";
export class ContextPlaybook {
	private playbookPath: string;
	constructor(playbookPath?: string) {
		const cfg = ROOT
			? // biome-ignore lint/suspicious/noExplicitAny: bootstrap config
				(globalThis as any)._config || loadConfig()
			: loadConfig();
		const aceDir = cfg.workflow.paths.ace_dir || "data/ace";
		this.playbookPath =
			playbookPath || path.join(ROOT, aceDir, "playbook.json");
	}
	load(): Playbook {
		if (!fs.existsSync(this.playbookPath)) {
			return { bullets: [] };
		}
		const data = fs.readJsonSync(this.playbookPath);
		return PlaybookSchema.parse(data);
	}
	save(playbook: Playbook) {
		fs.ensureDirSync(path.dirname(this.playbookPath));
		fs.writeJsonSync(this.playbookPath, playbook, { spaces: 2 });
	}
	getRankedBullets(limit = 10): AceBullet[] {
		const playbook = this.load();
		return playbook.bullets
			.sort((a, b) => b.confidence - a.confidence)
			.slice(0, limit);
	}
	addBullet(bullet: AceBullet) {
		const playbook = this.load();
		const exists = playbook.bullets.some(
			(b) => b.content.toLowerCase() === bullet.content.toLowerCase(),
		);
		if (!exists) {
			playbook.bullets.push(bullet);
			this.save(playbook);
		}
	}
	updateBullet(bulletId: string, updates: Partial<AceBullet>) {
		const playbook = this.load();
		const index = playbook.bullets.findIndex((b) => b.id === bulletId);
		if (index !== -1) {
			playbook.bullets[index] = {
				...playbook.bullets[index],
				...updates,
			} as AceBullet;
			this.save(playbook);
		}
	}
}
