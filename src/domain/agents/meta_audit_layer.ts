import path from "node:path";
import fs from "fs-extra";
import { type AssetStore, BaseAgent, ROOT, RunStage } from "../../io/core.js";
import type {
	AgentState,
	AuditCheck,
	GenerationDynamics,
	StrategyGenome,
} from "../types.js";

export type AdaptiveSurvivabilityStatus =
	| "SURVIVABLE"
	| "COLLAPSING"
	| "OVERFITTING"
	| "PREDICTABLE"
	| "NOVELTY_STARVED"
	| "EMOTIONALLY_FLAT"
	| "ALGORITHM_DEPENDENT";

export interface StrategyConvergenceReport {
	emotional_path_entropy: number;
	hook_pattern_diversity: number;
	cadence_diversity: number;
	memory_anchor_distribution: Record<string, number>;
	narrative_weapon_distribution: Record<string, number>;
	audience_state_diversity: number;
	fear_narrative_ratio: number;
	collapse_risk_detected: boolean;
	status: "PASS" | "COLLAPSE_RISK";
}

export interface AttentionEntropyReport {
	repeated_cadence_count: number;
	repeated_rhetorical_count: number;
	repeated_emotional_timing_count: number;
	repeated_opening_rhythm_count: number;
	audience_predictability_score: number; // 0.0 (unpredictable) to 1.0 (highly predictable)
	status: "PASS" | "WARNING" | "FATIGUED";
}

export interface MutationScheduleReport {
	recommended_strategy_mutation: string;
	recommended_cadence_mutation: string;
	exploration_budget_ratio: number;
	exploration_mode_active: boolean;
}

export interface EvolutionBudgetReport {
	portfolio_distribution: {
		stable_content: number; // e.g. 0.60
		adjacent_exploration: number; // e.g. 0.25
		radical_experiment: number; // e.g. 0.15
	};
	status: string;
}

export interface MetaAuditReport {
	run_id: string;
	timestamp: string;
	survivability: AdaptiveSurvivabilityStatus;
	strategy_convergence: StrategyConvergenceReport;
	attention_entropy: AttentionEntropyReport;
	mutation_schedule: MutationScheduleReport;
	evolution_budget: EvolutionBudgetReport;
}

export class MetaAuditLayer extends BaseAgent {
	constructor(store: AssetStore) {
		super(store, RunStage.AUDIT);
	}

	/**
	 * Main execution method for the Meta Audit Layer.
	 * Aggregates ledger data, evaluates long-term trends and outputs the survivability status.
	 */
	runMetaAudit(
		state: AgentState,
		currentDynamics: GenerationDynamics,
		pastDynamics: GenerationDynamics[],
	): MetaAuditReport {
		const runId = state.run_id || path.basename(this.store.runDir);
		const recent = pastDynamics.slice(-10); // Analyze up to last 10 runs

		// 1. Strategy Convergence Audit
		const convergence = this.auditStrategyConvergence(currentDynamics, recent);

		// 2. Attention Entropy Tracking
		const attentionEntropy = this.trackAttentionEntropy(
			currentDynamics,
			recent,
		);

		// 3. Mutation Scheduling
		const mutationSchedule = this.scheduleMutations(
			currentDynamics,
			attentionEntropy,
		);

		// 4. Evolution Budget Management
		const evolutionBudget = this.manageEvolutionBudget(
			attentionEntropy,
			convergence,
		);

		// 5. Evaluate Overall Adaptive Survivability
		const survivability = this.evaluateChannelAdaptiveSurvivability(
			convergence,
			attentionEntropy,
			mutationSchedule,
		);

		const report: MetaAuditReport = {
			run_id: runId,
			timestamp: new Date().toISOString(),
			survivability,
			strategy_convergence: convergence,
			attention_entropy: attentionEntropy,
			mutation_schedule: mutationSchedule,
			evolution_budget: evolutionBudget,
		};

		// Persist report to run directory
		const metaAuditDir = path.join(this.store.runDir, "audit");
		fs.ensureDirSync(metaAuditDir);
		fs.writeJsonSync(
			path.join(metaAuditDir, "meta_audit_report.json"),
			report,
			{
				spaces: 2,
			},
		);

		return report;
	}

	/**
	 * Anti-Convergence Auditor: Detects strategy convergence, duplication and pattern locking.
	 */
	private auditStrategyConvergence(
		current: GenerationDynamics,
		recent: GenerationDynamics[],
	): StrategyConvergenceReport {
		if (recent.length === 0) {
			return {
				emotional_path_entropy: 1.0,
				hook_pattern_diversity: 1.0,
				cadence_diversity: 1.0,
				memory_anchor_distribution: {},
				narrative_weapon_distribution: {},
				audience_state_diversity: 1.0,
				fear_narrative_ratio: 0.0,
				collapse_risk_detected: false,
				status: "PASS",
			};
		}

		const totalCount = recent.length + 1;
		const allDynamics = [...recent, current];

		// Calculate distributions
		const cadenceCounts: Record<string, number> = {};
		const hookCounts: Record<string, number> = {};
		const weaponCounts: Record<string, number> = {};
		const anchorCounts: Record<string, number> = {};

		let fearNarrativeCount = 0;

		for (const d of allDynamics) {
			const genome = d.strategy_genome;
			cadenceCounts[genome.cadence_profile] =
				(cadenceCounts[genome.cadence_profile] || 0) + 1;
			hookCounts[genome.hook_pattern] =
				(hookCounts[genome.hook_pattern] || 0) + 1;
			weaponCounts[genome.narrative_weapon] =
				(weaponCounts[genome.narrative_weapon] || 0) + 1;
			anchorCounts[genome.memory_anchor_type] =
				(anchorCounts[genome.memory_anchor_type] || 0) + 1;

			if (
				genome.narrative_weapon.toLowerCase().includes("fear") ||
				genome.narrative_weapon.toLowerCase().includes("anxiety") ||
				d.narrative_state.emotion_path.includes("fear")
			) {
				fearNarrativeCount++;
			}
		}

		// Calculate ratios and diversities
		const fearNarrativeRatio = fearNarrativeCount / totalCount;
		const cadenceDiversity = Object.keys(cadenceCounts).length / totalCount;
		const hookPatternDiversity = Object.keys(hookCounts).length / totalCount;
		const audienceStateDiversity =
			Object.keys(anchorCounts).length / totalCount;

		// Calculate Shannon Entropy for emotional path lengths/types
		const emotionalPathCounts: Record<string, number> = {};
		for (const d of allDynamics) {
			const pathStr = d.strategy_genome.emotion_curve.join("->");
			emotionalPathCounts[pathStr] = (emotionalPathCounts[pathStr] || 0) + 1;
		}
		let emotionalPathEntropy = 0;
		for (const count of Object.values(emotionalPathCounts)) {
			const p = count / totalCount;
			emotionalPathEntropy -= p * Math.log2(p);
		}

		// Detect collapse risk if fear narrative dominates (> 70%) or cadence/hook diversity is extremely low (< 30%)
		const collapseRiskDetected =
			fearNarrativeRatio > 0.7 ||
			(totalCount >= 5 &&
				(cadenceDiversity < 0.3 || hookPatternDiversity < 0.3));

		return {
			emotional_path_entropy: Number(emotionalPathEntropy.toFixed(2)),
			hook_pattern_diversity: Number(hookPatternDiversity.toFixed(2)),
			cadence_diversity: Number(cadenceDiversity.toFixed(2)),
			memory_anchor_distribution: anchorCounts,
			narrative_weapon_distribution: weaponCounts,
			audience_state_diversity: Number(audienceStateDiversity.toFixed(2)),
			fear_narrative_ratio: Number(fearNarrativeRatio.toFixed(2)),
			collapse_risk_detected: collapseRiskDetected,
			status: collapseRiskDetected ? "COLLAPSE_RISK" : "PASS",
		};
	}

	/**
	 * Attention Entropy Tracker: Measures attention predictability accumulation over time.
	 */
	private trackAttentionEntropy(
		current: GenerationDynamics,
		recent: GenerationDynamics[],
	): AttentionEntropyReport {
		if (recent.length === 0) {
			return {
				repeated_cadence_count: 0,
				repeated_rhetorical_count: 0,
				repeated_emotional_timing_count: 0,
				repeated_opening_rhythm_count: 0,
				audience_predictability_score: 0.0,
				status: "PASS",
			};
		}

		const recent5 = recent.slice(-5);
		let repeatedCadence = 0;
		let repeatedOpening = 0;
		let repeatedEmotional = 0;

		const currentGenome = current.strategy_genome;

		for (const prev of recent5) {
			const prevGenome = prev.strategy_genome;
			if (prevGenome.cadence_profile === currentGenome.cadence_profile) {
				repeatedCadence++;
			}
			if (prevGenome.intro_type === currentGenome.intro_type) {
				repeatedOpening++;
			}
			if (
				JSON.stringify(prevGenome.emotion_curve) ===
				JSON.stringify(currentGenome.emotion_curve)
			) {
				repeatedEmotional++;
			}
		}

		// Calculate predictability score from 0.0 to 1.0
		const cadenceWeight = repeatedCadence / Math.max(1, recent5.length);
		const openingWeight = repeatedOpening / Math.max(1, recent5.length);
		const emotionalWeight = repeatedEmotional / Math.max(1, recent5.length);

		const audiencePredictabilityScore =
			cadenceWeight * 0.4 + openingWeight * 0.3 + emotionalWeight * 0.3;

		let status: "PASS" | "WARNING" | "FATIGUED" = "PASS";
		if (audiencePredictabilityScore > 0.7) {
			status = "FATIGUED";
		} else if (audiencePredictabilityScore > 0.4) {
			status = "WARNING";
		}

		return {
			repeated_cadence_count: repeatedCadence,
			repeated_rhetorical_count: 0,
			repeated_emotional_timing_count: repeatedEmotional,
			repeated_opening_rhythm_count: repeatedOpening,
			audience_predictability_score: Number(
				audiencePredictabilityScore.toFixed(2),
			),
			status,
		};
	}

	/**
	 * Mutation Scheduler: Dictates controlled evolutionary mutations to avoid overfitting.
	 */
	private scheduleMutations(
		current: GenerationDynamics,
		entropy: AttentionEntropyReport,
	): MutationScheduleReport {
		let recomStrategy = "none (stabilized variance)";
		let recomCadence = "none (cadence variance preserved)";
		let explorationBudget = 0.15;
		let active = false;

		// High predictability drives structural mutation scheduling
		if (entropy.audience_predictability_score > 0.6) {
			active = true;
			explorationBudget = 0.4; // force higher exploration budget
			recomStrategy =
				"Injected 15% future-mapping narrative mutation to break topic lock.";
			recomCadence =
				"Injected 'unexpected silence' pattern interrupt intro mutation.";
		} else if (entropy.audience_predictability_score > 0.3) {
			active = true;
			explorationBudget = 0.25;
			recomStrategy = "Slight strategy shift to adjacent investment concepts.";
		}

		return {
			recommended_strategy_mutation: recomStrategy,
			recommended_cadence_mutation: recomCadence,
			exploration_budget_ratio: explorationBudget,
			exploration_mode_active: active,
		};
	}

	/**
	 * Evolution Budget Manager: Safe zone, exploration, mutation and high-risk experiment allocation.
	 */
	private manageEvolutionBudget(
		entropy: AttentionEntropyReport,
		convergence: StrategyConvergenceReport,
	): EvolutionBudgetReport {
		// Defaults: 60% stable, 25% adjacent, 15% radical
		let stable = 0.6;
		let adjacent = 0.25;
		let radical = 0.15;

		let status = "BALANCED";

		if (convergence.collapse_risk_detected || entropy.status === "FATIGUED") {
			// Trigger radical exploration due to cognitive fatigue / repetition lock
			stable = 0.3;
			adjacent = 0.4;
			radical = 0.3;
			status = "DIVERSIFY_IMMEDIATELY";
		} else if (entropy.status === "WARNING") {
			stable = 0.5;
			adjacent = 0.35;
			radical = 0.15;
			status = "EXPAND_EXPLORATION";
		}

		return {
			portfolio_distribution: {
				stable_content: stable,
				adjacent_exploration: adjacent,
				radical_experiment: radical,
			},
			status,
		};
	}

	/**
	 * Channel Adaptive Survivability Evaluation.
	 */
	private evaluateChannelAdaptiveSurvivability(
		convergence: StrategyConvergenceReport,
		entropy: AttentionEntropyReport,
		mutation: MutationScheduleReport,
	): AdaptiveSurvivabilityStatus {
		if (convergence.collapse_risk_detected && entropy.status === "FATIGUED") {
			return "COLLAPSING";
		}
		if (convergence.collapse_risk_detected) {
			return "OVERFITTING";
		}
		if (entropy.status === "FATIGUED") {
			return "PREDICTABLE";
		}
		if (convergence.emotional_path_entropy < 0.5) {
			return "EMOTIONALLY_FLAT";
		}
		if (mutation.exploration_budget_ratio > 0.3) {
			return "NOVELTY_STARVED";
		}
		return "SURVIVABLE";
	}
}
