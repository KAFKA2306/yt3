import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import {
	type AssetStore,
	BaseAgent,
	ROOT,
	RunStage,
	parseLlmJson,
} from "../../io/core.js";
import {
	type AgentState,
	type AttentionState,
	AttentionStateSchema,
	AudienceResponseStateSchema,
	EvolutionStateSchema,
	type GenerationDynamics,
	GenerationDynamicsSchema,
	type GenerationState,
	GenerationStateSchema,
	type Metadata,
	type NarrativeState,
	NarrativeStateSchema,
	type NewsItem,
	type PublishResults,
	PublishStateSchema,
	type Script,
	type SelectionReason,
	SelectionReasonSchema,
	type StrategyGenome,
	StrategyGenomeSchema,
	type WorldState,
	WorldStateSchema,
} from "../types.js";

export class DynamicsOrchestrator extends BaseAgent {
	constructor(store: AssetStore) {
		super(store, RunStage.AUDIT);
	}

	/**
	 * Scans past run directories to gather historical generation dynamics.
	 */
	getPastDynamics(): GenerationDynamics[] {
		const past: GenerationDynamics[] = [];
		const runsDir = path.join(ROOT, "runs");
		if (!fs.existsSync(runsDir)) return past;
		const dirs = fs.readdirSync(runsDir).filter((name) => {
			const fullPath = path.join(runsDir, name);
			return (
				fs.statSync(fullPath).isDirectory() &&
				name !== "runs" &&
				name !== "audit-demo"
			);
		});

		for (const dir of dirs) {
			const dynPath = path.join(runsDir, dir, "generation_dynamics.json");
			if (fs.existsSync(dynPath)) {
				const dynObj = fs.readJsonSync(dynPath);
				const parsed = GenerationDynamicsSchema.parse(dynObj);
				past.push(parsed);
			}
		}
		return past;
	}

	/**
	 * Phase 1: Synthesize World State and Topic Selection State based on Trend research
	 */
	async synthesizeResearchDynamics(
		news: NewsItem[],
		directorData: NonNullable<AgentState["director_data"]>,
	): Promise<{ world_state: WorldState; selection_state: SelectionReason }> {
		const systemPrompt = `You are the Chief Macro Analyst for "Byosan Money" operating under the AUDIT DRIVEN MEDIA SYSTEM CONTRACT.
Your supreme mandate:
1. FACTS FIRST. Classify current macro worries, anxieties and market attention topics.
2. SPECIFICITY. Provide objective densities and metrics without abstract praise.
3. ANTI-COLLAPSE. Reject sensationalist or end-of-world narratives in favor of adaptive growth indicators.

Output MUST be a single JSON object matching this schema:
{
  "world_state": {
    "macro_anxiety": ["anxiety string", ...],
    "market_attention": ["attention topic", ...],
    "competition_density": number (0.0 to 1.0),
    "novelty_supply": number (0.0 to 1.0)
  },
  "selection_state": {
    "expected_attention_gain": number (0.0 to 1.0),
    "memory_potential": number (0.0 to 1.0),
    "behavioral_relevance": number (0.0 to 1.0),
    "saturation_risk": number (0.0 to 1.0)
  }
}
Output strictly valid JSON.`;

		const userMessage = JSON.stringify({
			news_themes: news.map((n) => ({ title: n.title, summary: n.summary })),
			director_angle: directorData?.angle,
			director_hook: directorData?.title_hook,
		});

		const result = await this.runLlm(
			systemPrompt,
			userMessage,
			(text) =>
				parseLlmJson(
					text,
					z.object({
						world_state: WorldStateSchema,
						selection_state: SelectionReasonSchema,
					}),
				),
			{ temperature: 0.1 },
		);

		return result;
	}

	/**
	 * Phase 2: Synthesize Strategy Genome, Narrative, Generation, and Simulated Attention States
	 */
	async synthesizeNarrativeDynamics(
		script: Script,
		metadata: Metadata,
	): Promise<{
		strategy_genome: StrategyGenome;
		narrative_state: NarrativeState;
		generation_state: GenerationState;
		attention_state: AttentionState;
	}> {
		const systemPrompt = `You are the Cognitive Designer and Audience Retention Auditor for "Byosan Money".
Based on the final script lines and metadata, analyze and extract the cognitive transition parameters.
Determine:
1. strategy_genome: Extract key strategic genome properties (intro_type, emotion_curve e.g. ["fear", "surprise", "clarity"], cadence_profile, memory_anchor_type, hook_pattern, narrative_weapon).
2. narrative_state: Viewer cognitive transition design. Define initial state, target state, emotion path (e.g. ["fear", "surprise", "understanding", "urgency"]), prediction gap strategy, and memory anchor.
3. generation_state: Parameter drift metrics. Extract strategy name, intro type (e.g., high_delta_fact, surprise_metric, unexpected_analogy), cadence profile (e.g., fast_open_slow_middle_fast_end, stable_dialogue, rapid_fire), anchor distributions (e.g., timestamps in seconds where key events happen), and novelty interval in seconds.
4. attention_state: Simulate attention retention. Estimate drop points (in seconds), cognitive load curve (e.g. 4 points representing progress curve from 0.0 to 1.0), certainty saturation (0.0 to 1.0), prediction gap density, and overall fatigue risk (0.0 to 1.0).

Output MUST be a single JSON object matching this schema:
{
  "strategy_genome": {
    "intro_type": string,
    "emotion_curve": [string, ...],
    "cadence_profile": string,
    "memory_anchor_type": string,
    "hook_pattern": string,
    "narrative_weapon": string
  },
  "narrative_state": {
    "audience_initial_state": string,
    "target_state": string,
    "emotion_path": [string, ...],
    "prediction_gap_strategy": string,
    "memory_anchor": string
  },
  "generation_state": {
    "strategy": string,
    "intro_type": string,
    "cadence_profile": string,
    "anchor_distribution": [number, ...],
    "novelty_interval_sec": number
  },
  "attention_state": {
    "predicted_drop_points": [number, ...],
    "cognitive_load_curve": [number, ...],
    "certainty_saturation": number,
    "prediction_gap_density": number,
    "fatigue_risk": number
  }
}
Output strictly valid JSON. Do not include abstract praise.`;

		const userMessage = JSON.stringify({
			title: script.title,
			description: script.description,
			metadata_title: metadata?.title,
			metadata_thumbnail: metadata?.thumbnail_title,
			script_lines_sample: script.lines
				.slice(0, 50)
				.map((l) => `${l.speaker}: ${l.text}`),
		});

		const result = await this.runLlm(
			systemPrompt,
			userMessage,
			(text) =>
				parseLlmJson(
					text,
					z.object({
						strategy_genome: StrategyGenomeSchema,
						narrative_state: NarrativeStateSchema,
						generation_state: GenerationStateSchema,
						attention_state: AttentionStateSchema,
					}),
				),
			{ temperature: 0.1 },
		);

		return result;
	}

	/**
	 * Phase 3: Compile final Dynamics, simulate audience response, and execute controlled evolutionary mutation
	 */
	calculateEvolution(
		world: WorldState,
		selection: SelectionReason,
		genome: StrategyGenome,
		narrative: NarrativeState,
		generation: GenerationState,
		attention: AttentionState,
		publishResults?: PublishResults,
	): GenerationDynamics {
		const runId = path.basename(this.store.runDir);

		// Load past dynamics to detect drift
		const past = this.getPastDynamics();
		const recent = past.slice(-5);

		// Calculate parameter drift frequencies
		const cadenceFreq: Record<string, number> = {};
		const introFreq: Record<string, number> = {};
		const strategyFreq: Record<string, number> = {};

		for (const d of recent) {
			cadenceFreq[d.generation_state.cadence_profile] =
				(cadenceFreq[d.generation_state.cadence_profile] || 0) + 1;
			introFreq[d.generation_state.intro_type] =
				(introFreq[d.generation_state.intro_type] || 0) + 1;
			strategyFreq[d.generation_state.strategy] =
				(strategyFreq[d.generation_state.strategy] || 0) + 1;
		}

		// Check if current choices represent drift (i.e. used in >= 60% of past 5 runs)
		const countThreshold = Math.max(2, Math.floor(recent.length * 0.6));
		const duplicateCadence =
			(cadenceFreq[generation.cadence_profile] || 0) >= countThreshold;
		const duplicateIntro =
			(introFreq[generation.intro_type] || 0) >= countThreshold;
		const duplicateStrategy =
			(strategyFreq[generation.strategy] || 0) >= countThreshold;

		// Calculate Strategy Mutation Engine
		let strategyMutation = "none (stabilized variance)";
		let cadenceMutation = "none (cadence variance preserved)";
		let adaptiveVariance = 0.5;
		let explorationMode = false;

		if (duplicateStrategy) {
			explorationMode = true;
			strategyMutation =
				"Injected 15% future-mapping narrative mutation to break topic lock.";
			adaptiveVariance += 0.2;
		}

		if (duplicateCadence || duplicateIntro) {
			explorationMode = true;
			cadenceMutation =
				"Injected 'unexpected silence' pattern interrupt intro mutation.";
			adaptiveVariance += 0.2;
		}

		// Build simulated audience response based on calculated fatigue
		// High fatigue is triggered when the same strategy/cadence drifts consecutively
		const fatigueModifier =
			(duplicateCadence ? 0.2 : 0) + (duplicateStrategy ? 0.2 : 0);
		const fatigue = Math.min(1.0, attention.fatigue_risk + fatigueModifier);

		const publishState = {
			platform: "youtube",
			visibility: publishResults?.youtube?.privacy_status || "private",
			target_channel:
				process.env.YOUTUBE_EXPECTED_CHANNEL_TITLE || "秒算マネー",
			title_length: publishResults?.youtube?.video_id ? 45 : 0,
			description_length: publishResults?.youtube?.video_id ? 150 : 0,
		};

		const audienceResponse = {
			retention_shape:
				fatigue > 0.6 ? "mid_decay_steep" : "early_spike_mid_decay",
			replay_segments: fatigue > 0.6 ? [] : [15, 45, 90],
			comment_semantics:
				fatigue > 0.6
					? ["too repetitive", "same cadence", "predictable facts"]
					: ["unexpected insight", "finally understood", "highly strategic"],
			behavior_shift: {
				subscribe_rate: fatigue > 0.6 ? 0.02 : 0.08,
				returning_viewer_gain: fatigue > 0.6 ? 0.01 : 0.05,
				session_extension: fatigue > 0.6 ? 0.8 : 1.7,
			},
		};

		const evolutionState = {
			strategy_mutation: strategyMutation,
			cadence_mutation: cadenceMutation,
			adaptive_variance_ratio: Math.min(1.0, adaptiveVariance),
			exploration_mode_active: explorationMode,
		};

		return {
			run_id: runId,
			strategy_genome: genome,
			world_state: world,
			selection_state: selection,
			narrative_state: narrative,
			generation_state: generation,
			attention_state: attention,
			publish_state: publishState,
			audience_response_state: audienceResponse,
			evolution_state: evolutionState,
		};
	}

	/**
	 * Orchestrates the full synthesis of generation dynamics.
	 */
	async synthesizeEvolutionDynamics(
		state: Partial<AgentState>,
	): Promise<GenerationDynamics> {
		if (!state.news || !state.director_data) {
			throw new Error(
				"Missing news or director_data for research dynamics synthesis",
			);
		}
		const { world_state, selection_state } =
			await this.synthesizeResearchDynamics(state.news, state.director_data);

		if (!state.script || !state.metadata) {
			throw new Error(
				"Missing script or metadata for narrative dynamics synthesis",
			);
		}
		const {
			strategy_genome,
			narrative_state,
			generation_state,
			attention_state,
		} = await this.synthesizeNarrativeDynamics(state.script, state.metadata);

		return this.calculateEvolution(
			world_state,
			selection_state,
			strategy_genome,
			narrative_state,
			generation_state,
			attention_state,
			state.publish_results,
		);
	}
}
