import { z } from "zod";

export const StrategyGenomeSchema = z.object({
	intro_type: z.string(),
	emotion_curve: z.array(z.string()),
	cadence_profile: z.string(),
	memory_anchor_type: z.string(),
	hook_pattern: z.string(),
	narrative_weapon: z.string(),
});
export type StrategyGenome = z.infer<typeof StrategyGenomeSchema>;

export const WorldStateSchema = z.object({
	macro_anxiety: z.array(z.string()),
	market_attention: z.array(z.string()),
	competition_density: z.number(),
	novelty_supply: z.number(),
});
export type WorldState = z.infer<typeof WorldStateSchema>;

export const SelectionReasonSchema = z.object({
	expected_attention_gain: z.number(),
	memory_potential: z.number(),
	behavioral_relevance: z.number(),
	saturation_risk: z.number(),
});
export type SelectionReason = z.infer<typeof SelectionReasonSchema>;

export const NarrativeStateSchema = z.object({
	audience_initial_state: z.string(),
	target_state: z.string(),
	emotion_path: z.array(z.string()),
	prediction_gap_strategy: z.string(),
	memory_anchor: z.string(),
});
export type NarrativeState = z.infer<typeof NarrativeStateSchema>;

export const GenerationStateSchema = z.object({
	strategy: z.string(),
	intro_type: z.string(),
	cadence_profile: z.string(),
	anchor_distribution: z.array(z.number()),
	novelty_interval_sec: z.number(),
});
export type GenerationState = z.infer<typeof GenerationStateSchema>;

export const AttentionStateSchema = z.object({
	predicted_drop_points: z.array(z.number()),
	cognitive_load_curve: z.array(z.number()),
	certainty_saturation: z.number(),
	prediction_gap_density: z.number(),
	fatigue_risk: z.number(),
});
export type AttentionState = z.infer<typeof AttentionStateSchema>;

export const PublishStateSchema = z.object({
	platform: z.string(),
	visibility: z.string(),
	target_channel: z.string(),
	title_length: z.number(),
	description_length: z.number(),
});
export type PublishState = z.infer<typeof PublishStateSchema>;

export const AudienceResponseStateSchema = z.object({
	retention_shape: z.string(),
	replay_segments: z.array(z.number()),
	comment_semantics: z.array(z.string()),
	behavior_shift: z.object({
		subscribe_rate: z.number(),
		returning_viewer_gain: z.number(),
		session_extension: z.number(),
	}),
});
export type AudienceResponseState = z.infer<typeof AudienceResponseStateSchema>;

export const EvolutionStateSchema = z.object({
	strategy_mutation: z.string(),
	cadence_mutation: z.string(),
	adaptive_variance_ratio: z.number(),
	exploration_mode_active: z.boolean(),
});
export type EvolutionState = z.infer<typeof EvolutionStateSchema>;

export const GenerationDynamicsSchema = z.object({
	run_id: z.string(),
	strategy_genome: StrategyGenomeSchema,
	world_state: WorldStateSchema,
	selection_state: SelectionReasonSchema,
	narrative_state: NarrativeStateSchema,
	generation_state: GenerationStateSchema,
	attention_state: AttentionStateSchema,
	publish_state: PublishStateSchema,
	audience_response_state: AudienceResponseStateSchema,
	evolution_state: EvolutionStateSchema,
});
export type GenerationDynamics = z.infer<typeof GenerationDynamicsSchema>;
