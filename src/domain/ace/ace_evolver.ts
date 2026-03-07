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

		// Autonomous SKILL Refinement Loop
		const skillFiles = [
			{
				name: "market-intelligence",
				path: ".agent/skills/market_intelligence/SKILL.md",
			},
			{
				name: "viral-narrative",
				path: ".agent/skills/viral_narrative/SKILL.md",
			},
		];

		for (const skill of skillFiles) {
			const absolutePath = path.join(ROOT, skill.path);
			if (fs.existsSync(absolutePath)) {
				await this.refineSkillWithLlm(skill.name, absolutePath, signals);
			}
		}
	}

	private async refineSkillWithLlm(
		skillName: string,
		skillPath: string,
		signals: EvaluationSignal[],
	) {
		const currentContent = fs.readFileSync(skillPath, "utf-8");
		const relevantSignals = signals.filter(
			(s) =>
				s.reason.toLowerCase().includes(skillName.toLowerCase()) || !s.success,
		);

		if (relevantSignals.length === 0) return;

		Logger.info(
			"AceEvolver",
			"REFINE",
			"START",
			`Refining SKILL: ${skillName} based on ${relevantSignals.length} signals`,
		);

		const llm = createLlm({
			temperature: 0.2,
		});

		const systemPrompt = `You are the SKILL Optimizer.
Your job is to rewrite the provided SKILL.md content to address failures and reinforce successes identified in the evaluation signals.
Focus on:
1. **Repetition**: If topics are repetitive, strengthen the 'Diversity' or 'Source' sections.
2. **Sensationalism**: If titles are too aggressive, tighten the 'Meta' or 'Narrative' rules.

Maintain the EXACT same Markdown structure (Frontmatter, Headers).
Do not add any meta-commentary. Just output the NEW content of the SKILL.md file.`;

		const userPrompt = `Current SKILL content (${skillName}):
${currentContent}

Evaluation Signals:
${JSON.stringify(relevantSignals, null, 2)}

Rewrite the SKILL.md content to optimize for the feedback provided.`;

		const response = await llm.invoke([
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userPrompt },
		]);

		const newContent = response.content as string;
		if (newContent && newContent.length > 100) {
			fs.writeFileSync(skillPath, newContent);
			Logger.info(
				"AceEvolver",
				"REFINE",
				"SUCCESS",
				`Updated ${skillName} SKILL definition autonomously.`,
			);
		}
	}
}
