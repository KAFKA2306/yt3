import { z } from "zod";
import { loadConfig } from "../../io/core.js";

const PanelConfigSchema = z.object({
	candidates: z.number().int().min(1),
	candidate_instruction: z.string().min(1),
	review_system: z.string().min(1),
	personas: z
		.array(
			z.object({ name: z.string().min(1), description: z.string().min(1) }),
		)
		.min(1),
});

export type PanelConfig = z.infer<typeof PanelConfigSchema>;

export const PanelReviewSchema = z.object({
	reviews: z.array(
		z.object({
			persona: z.string().min(1),
			score: z.number().int().min(1).max(5),
			fix: z.string().min(1),
		}),
	),
});

export type PanelReview = z.infer<typeof PanelReviewSchema>;

export function loadPanel(): PanelConfig {
	return PanelConfigSchema.parse(
		(loadConfig("byosan_money") as unknown as { llm: { panel: unknown } }).llm
			.panel,
	);
}

export function validatePanelReview(
	review: PanelReview,
	panel: PanelConfig,
): PanelReview {
	const names = panel.personas.map((persona) => persona.name);
	const got = review.reviews.map((entry) => entry.persona);
	if (
		got.length !== names.length ||
		names.some((name) => !got.includes(name))
	) {
		throw new Error(
			`PANEL_REVIEW_INVALID: personas must be exactly ${names.join(", ")}`,
		);
	}
	return review;
}

export function meanScore(review: PanelReview): number {
	return (
		review.reviews.reduce((sum, entry) => sum + entry.score, 0) /
		review.reviews.length
	);
}

export function renderPanelReviewPrompt(
	panel: PanelConfig,
	script: string,
): string {
	return [
		panel.review_system,
		...panel.personas.map(
			(persona) => `- ${persona.name}: ${persona.description}`,
		),
		"[台本]",
		script,
	].join("\n");
}

export function bestRound<T extends { mean: number }>(rounds: T[]): T {
	return rounds.reduce((best, round) =>
		round.mean >= best.mean ? round : best,
	);
}
