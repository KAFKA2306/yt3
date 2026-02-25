import { AgentLogger as Logger } from "../core.js";
import { ContextPlaybook } from "./context_playbook.js";
import type { AceBullet, EvaluationSignal } from "./types.js";
export class AceEvolver {
	private playbook: ContextPlaybook;
	constructor() {
		this.playbook = new ContextPlaybook();
	}
	async evolve(signals: EvaluationSignal[]) {
		const currentPlaybook = this.playbook.load();
		Logger.info(
			"AceEvolver",
			"EVOLVE",
			"START",
			`Evolving playbook with ${signals.length} signals`,
		);
		for (const signal of signals) {
			const bullet = currentPlaybook.bullets.find(
				(b) => b.id === signal.bullet_id,
			);
			if (bullet) {
				bullet.runs += 1;
				if (signal.success) {
					bullet.successes += 1;
				}
				const learningRate = 0.1 * signal.weight;
				if (signal.success) {
					bullet.confidence = Math.min(1.0, bullet.confidence + learningRate);
				} else {
					bullet.confidence = Math.max(0.0, bullet.confidence - learningRate);
				}
				Logger.info(
					"AceEvolver",
					"EVOLVE",
					"UPDATE",
					`Updated bullet ${bullet.id}: confidence=${bullet.confidence.toFixed(2)}`,
				);
			}
		}
		const prunedBullets = currentPlaybook.bullets.filter(
			(b) => b.runs < 5 || b.confidence > 0.2,
		);
		if (prunedBullets.length < currentPlaybook.bullets.length) {
			Logger.info(
				"AceEvolver",
				"EVOLVE",
				"PRUNE",
				`Pruned ${currentPlaybook.bullets.length - prunedBullets.length} low-performing bullets`,
			);
		}
		currentPlaybook.bullets = prunedBullets;
		this.playbook.save(currentPlaybook);
	}
	async refineBulletsWithLlm(bullets: AceBullet[]): Promise<AceBullet[]> {
		Logger.info(
			"AceEvolver",
			"REFINE",
			"START",
			`Refining ${bullets.length} bullets (placeholder)`,
		);
		return bullets;
	}
}
