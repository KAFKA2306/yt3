import path from "node:path";
import fs from "fs-extra";
import { AgentLogger as Logger, ROOT, createLlm } from "../../io/core.ts";
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
			let bullet = currentPlaybook.bullets.find(
				(b) => b.id === signal.bullet_id,
			);
			if (!bullet) {
				// Auto-create new bullet for discovered strategic signals (like soft-metrics)
				bullet = {
					id: signal.bullet_id,
					content: `Auto-generated rule for ${signal.bullet_id}`,
					source: "Evolution",
					confidence: 0.5,
					runs: 0,
					successes: 0,
					category: "Structural",
					alpha: 1.0,
					beta: 1.0,
				};
				currentPlaybook.bullets.push(bullet);
				Logger.info(
					"AceEvolver",
					"EVOLVE",
					"NEW_BULLET",
					`Registered new strategic target: ${bullet.id}`,
				);
			}

			bullet.runs += 1;
			// Bayesian Update (Beta Distribution)
			const weight = signal.weight || 1.0;
			if (signal.success) {
				bullet.successes += 1;
				bullet.alpha = (bullet.alpha || 1.0) + weight;
			} else {
				bullet.beta = (bullet.beta || 1.0) + weight;
			}
			// Confidence is the mean of the Beta distribution: α / (α + β)
			bullet.confidence = bullet.alpha / (bullet.alpha + bullet.beta);

			Logger.info(
				"AceEvolver",
				"EVOLVE",
				"UPDATE",
				`Updated bullet ${bullet.id}: confidence=${bullet.confidence.toFixed(2)} (α=${bullet.alpha.toFixed(1)}, β=${bullet.beta.toFixed(1)})`,
			);
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
}
