import { describe, expect, test } from "bun:test";
import {
	PanelReviewSchema,
	bestRound,
	loadPanel,
	meanScore,
	validatePanelReview,
} from "../src/domain/byosan/panel.js";

const reviewOf = (scores: number[]) =>
	PanelReviewSchema.parse({
		reviews: loadPanel().personas.map((persona, index) => ({
			persona: persona.name,
			score: scores[index],
			fix: "直す",
		})),
	});

describe("byosan panel", () => {
	test("parses the structured review and averages the scores", () => {
		const review = validatePanelReview(reviewOf([5, 4, 3, 2, 1]), loadPanel());
		expect(meanScore(review)).toBe(3);
	});

	test("rejects a review that misses a persona or scores out of range", () => {
		const review = reviewOf([3, 3, 3, 3, 3]);
		expect(() =>
			validatePanelReview({ reviews: review.reviews.slice(1) }, loadPanel()),
		).toThrow("PANEL_REVIEW_INVALID");
		expect(() =>
			PanelReviewSchema.parse({
				reviews: [{ persona: "a", score: 6, fix: "x" }],
			}),
		).toThrow();
	});

	test("the newest round wins a tie", () => {
		expect(
			bestRound([
				{ round: 1, mean: 3 },
				{ round: 2, mean: 3 },
				{ round: 3, mean: 2 },
			]).round,
		).toBe(2);
	});
});
