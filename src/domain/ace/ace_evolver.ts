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

		const updatedBulletMap = new Map(
			currentPlaybook.bullets.map((b) => [b.id, b])
		);

		for (const signal of signals) {
			let bullet = updatedBulletMap.get(signal.bullet_id);
			
			if (!bullet) {
				// Auto-create new bullet for discovered strategic signals
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
				Logger.info(
					"AceEvolver",
					"EVOLVE",
					"NEW_BULLET",
					`Registered new strategic target: ${bullet.id}`,
				);
			}

			// Bayesian Update (Beta Distribution)
			const weight = signal.weight || 1.0;
			const updatedBullet: AceBullet = {
				...bullet,
				runs: bullet.runs + 1,
				successes: signal.success ? bullet.successes + 1 : bullet.successes,
				alpha: signal.success ? (bullet.alpha || 1.0) + weight : bullet.alpha || 1.0,
				beta: !signal.success ? (bullet.beta || 1.0) + weight : bullet.beta || 1.0,
			};
			updatedBullet.confidence = updatedBullet.alpha / (updatedBullet.alpha + updatedBullet.beta);

			updatedBulletMap.set(signal.bullet_id, updatedBullet);

			Logger.info(
				"AceEvolver",
				"EVOLVE",
				"UPDATE",
				`Updated bullet ${updatedBullet.id}: confidence=${updatedBullet.confidence.toFixed(2)} (α=${updatedBullet.alpha.toFixed(1)}, β=${updatedBullet.beta.toFixed(1)})`,
			);
		}

		const allBullets = Array.from(updatedBulletMap.values());
		const prunedBullets = allBullets.filter(
			(b) => b.runs < 5 || b.confidence > 0.2,
		);
		if (prunedBullets.length < allBullets.length) {
			Logger.info(
				"AceEvolver",
				"EVOLVE",
				"PRUNE",
				`Pruned ${allBullets.length - prunedBullets.length} low-performing bullets`,
			);
		}
		
		const finalPlaybook = {
			...currentPlaybook,
			bullets: prunedBullets,
		};
		this.playbook.save(finalPlaybook);
	}
}
