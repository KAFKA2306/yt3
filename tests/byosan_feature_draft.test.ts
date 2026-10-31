import { describe, expect, test } from "bun:test";
import {
	featureDraftIssues,
	type Json,
	normalizeFeatureDraft,
	prepareFeatureDraftInput,
} from "../src/domain/byosan/feature_draft.js";
import { isBlockingFeatureIssue } from "../src/domain/byosan/feature_spec.js";
import { fixtureDraft, fixtureInput } from "./fixtures/byosan_draft.js";

const blocking = (draft: Json, input = fixtureInput()): string[] =>
	featureDraftIssues(draft, input)
		.filter((issue) => isBlockingFeatureIssue(issue))
		.map((issue) => `${issue.code}=${issue.details}`);

const withText = (draft: Json, text: string): Json => {
	const [first, ...rest] = draft.segments as Json[];
	return { ...draft, segments: [{ ...first, text }, ...rest] };
};

describe("normalizeFeatureDraft corrects format-only errors", () => {
	test("does not rewrite an impossible date", () => {
		const draft = fixtureDraft();
		const result = normalizeFeatureDraft({
			...draft,
			packaging: {
				primaryClaimId: "claim_0",
				claimIds: ["claim_0"],
				freshness: { claimId: "claim_0", eventDate: "2026-02-30" },
			},
		});
		expect(
			result.corrections.filter(
				(correction) => correction.rule === "event_date",
			),
		).toEqual([]);
	});

	test("fills a too-short segment source from the first claim source", () => {
		const draft = fixtureDraft();
		const [first, ...rest] = draft.segments as Json[];
		const result = normalizeFeatureDraft({
			...draft,
			segments: [{ ...first, source: "", claimIds: ["claim_0"] }, ...rest],
		});
		expect(result.corrections.map((correction) => correction.rule)).toContain(
			"segment_source",
		);
	});
});

describe("deterministic checks against the input articles", () => {
	test("a draft whose numbers and sources all come from the articles has no blocking issue", () => {
		expect(blocking(fixtureDraft())).toEqual([]);
	});

	test("a number found in no article blocks", () => {
		const issues = blocking(
			withText(
				fixtureDraft(),
				"利益が987654%も増えたのだ、という話を始めます。",
			),
		);
		expect(issues).toContain("unsourced_number=987654");
	});

	test("a claim number found in no article blocks", () => {
		const draft = fixtureDraft();
		const [first, second, ...rest] = draft.claims as Json[];
		const issues = blocking({
			...draft,
			claims: [
				first,
				{ ...second, claim: "利益は777777ドルに達したと報告されている" },
				...rest,
			],
		});
		expect(issues).toContain("unsourced_number=777777");
	});

	test("a source URL outside the input blocks", () => {
		const draft = fixtureDraft();
		const [first, ...rest] = draft.sources as Json[];
		expect(
			blocking({
				...draft,
				sources: [{ ...first, url: "https://example.com/other" }, ...rest],
			}),
		).toContain("source_not_in_input=https://example.com/other");
	});

	test("a quote that no article contains blocks", () => {
		const draft = fixtureDraft();
		const explanation = draft.explanation as Json & { figures: Json[] };
		const [figure, ...rest] = explanation.figures;
		expect(
			blocking({
				...draft,
				explanation: {
					...explanation,
					figures: [
						{ ...figure, quote: "47.4% in a sentence nobody wrote" },
						...rest,
					],
				},
			}),
		).toContain("figure_not_grounded=47.4%");
	});

	test("a published source is removed from the input and cited as already published", () => {
		const input = fixtureInput();
		const first = input.today[0];
		if (!first) throw new Error("fixture article is missing");
		const published = new Set([first.url.replace(/\/+$/, "")]);
		const prepared = prepareFeatureDraftInput({
			...input,
			publishedUrls: published,
		});
		expect(prepared.today.map((article) => article.url)).not.toContain(
			first.url,
		);
		expect(blocking(fixtureDraft(), prepared)).toContain(
			`source_already_published=${first.url}`,
		);
	});
});
