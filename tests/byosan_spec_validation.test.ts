import { describe, expect, test } from "bun:test";
import type { Explanation } from "../src/domain/byosan/explanation.js";
import {
	auditFeatureSpecAgainstExplanation,
	auditHookPromises,
	figureValueAppears,
	normalizeHookPromise,
} from "../src/domain/byosan/explanation_contract.js";
import type {
	ByosanFeatureSpec,
	FeatureSpecIssue,
} from "../src/domain/byosan/feature_spec.js";

const formatted = (issues: FeatureSpecIssue[]): string[] =>
	issues.map((issue) => `${issue.code}: ${issue.details}`);

const conclusion = "物価上昇は品物中心に強まった。";
const explanation: Explanation = {
	conclusion,
	principle: "原則です。",
	figures: [
		{
			metric: "消費者物価指数",
			population: "全国",
			period: "2026年9月",
			unit: "%",
			value: "+2.1%",
			quote: "+2.1%",
			kind: "actual",
		},
	],
	check: "確認です。",
};
const candidate = {
	numbers: ["2026年9月の消費者物価指数は前年比+2.1%"],
};
const bannedPhrases = ["まだ言えない", "分からない"];

type SegmentFixture = {
	text: string;
	headline?: string;
	verificationRole?: string;
};

function specWith(
	segments: SegmentFixture[],
	thumbnailLead = "上昇",
	claims: Array<{ confidence: number }> = [],
): ByosanFeatureSpec {
	return {
		title: "物価の話です",
		thumbnailTitle: "物価",
		thumbnail: {
			eyebrow: "速報",
			lead: thumbnailLead,
			accent: "上昇",
			reaction: "驚き",
			secondLine: "二行目",
			calloutTop: "上段",
			calloutBottom: "下段",
		},
		descriptionLead: "説明の導入文です。",
		descriptionBullets: ["限定条件を示します。"],
		hookPromises: ["2.1%"],
		claims,
		segments: segments.map((segment) => ({
			headline: segment.headline ?? "見出し",
			subheadline: "副題",
			text: segment.text,
			verificationRole: segment.verificationRole,
			stats: [],
		})),
	} as unknown as ByosanFeatureSpec;
}

const grounded = [
	{ text: "2026年9月は前年比+2.1%だった。", verificationRole: "presenter" },
	{
		text: `${conclusion}同じ数字を別の話者が確認するのだ。`,
		verificationRole: "landing",
	},
];

describe("feature spec contract against the explanation", () => {
	test("accepts a spec that carries the conclusion, figure values and only sourced numbers", () => {
		expect(
			auditFeatureSpecAgainstExplanation(
				specWith(grounded),
				explanation,
				candidate,
				bannedPhrases,
			),
		).toEqual([]);
	});

	test("compares conclusion and figure values after NFKC normalization", () => {
		const fullWidth: Explanation = {
			...explanation,
			figures: [{ ...explanation.figures[0], value: "＋2.1％" }],
		};
		expect(
			auditFeatureSpecAgainstExplanation(
				specWith(grounded),
				fullWidth,
				candidate,
				bannedPhrases,
			),
		).toEqual([]);
	});

	test("reports a figure value that no segment carries", () => {
		const issues = auditFeatureSpecAgainstExplanation(
			specWith([{ text: conclusion, verificationRole: "landing" }]),
			explanation,
			candidate,
			bannedPhrases,
		);
		expect(formatted(issues)).toContain(
			"explanation_figure_value_missing: +2.1%",
		);
	});

	test("reports a number with no source in the explanation, candidate or claim confidence", () => {
		const issues = auditFeatureSpecAgainstExplanation(
			specWith([
				{
					text: `${conclusion}前年比+2.1%で47%増えた。`,
					verificationRole: "landing",
				},
			]),
			explanation,
			candidate,
			bannedPhrases,
		);
		expect(formatted(issues)).toEqual(["unsourced_number: 47"]);
		expect(issues[0]?.path).toBe("segments[0]");
	});

	test("accepts a claim confidence stated as an integer percentage", () => {
		const withConfidence = specWith(
			[
				{
					text: "2026年9月は前年比+2.1%だった。",
					verificationRole: "presenter",
				},
				{
					text: `${conclusion}確度は65%なのだ。`,
					verificationRole: "landing",
				},
			],
			"上昇",
			[{ confidence: 0.65 }],
		);
		expect(
			auditFeatureSpecAgainstExplanation(
				withConfidence,
				explanation,
				candidate,
				bannedPhrases,
			),
		).toEqual([]);
	});

	test("checks numbers in thumbnail and description fields too", () => {
		const issues = auditFeatureSpecAgainstExplanation(
			specWith(grounded, "3倍"),
			explanation,
			candidate,
			bannedPhrases,
		);
		expect(formatted(issues)).toEqual(["unsourced_number: 3"]);
		expect(issues[0]?.path).toBe("thumbnail");
	});

	test("ignores ISO dates in the spec text", () => {
		const issues = auditFeatureSpecAgainstExplanation(
			specWith([
				{
					text: `${conclusion}2026-10-24の前年比+2.1%だった。`,
					verificationRole: "landing",
				},
			]),
			explanation,
			candidate,
			bannedPhrases,
		);
		expect(issues).toEqual([]);
	});

	test("flags a hedged phrase only in resolution or landing segments", () => {
		const presenterOnly = auditFeatureSpecAgainstExplanation(
			specWith([
				...grounded,
				{ text: "まだ言えないという声もある。", verificationRole: "presenter" },
			]),
			explanation,
			candidate,
			bannedPhrases,
		);
		expect(presenterOnly).toEqual([]);

		const landing = auditFeatureSpecAgainstExplanation(
			specWith([
				...grounded,
				{ text: "結論はまだ言えないのだ。", verificationRole: "landing" },
			]),
			explanation,
			candidate,
			bannedPhrases,
		);
		expect(formatted(landing)).toEqual([
			"banned_phrase_in_resolution_or_landing: まだ言えない",
		]);
		expect(landing[0]?.path).toBe("segments[2]");
	});
});

describe("figure values are matched by their number core and unit", () => {
	const figure = { value: "＋2.4％", unit: "%" };

	test("matches a spoken or half-width form with the same number and unit", () => {
		expect(figureValueAppears(figure, ["プラス2.4パーセント上昇した"])).toBe(
			true,
		);
		expect(figureValueAppears(figure, ["前年比+2.4%だった"])).toBe(true);
	});

	test("ignores the sign of the direction", () => {
		expect(figureValueAppears(figure, ["マイナス2.4%下がった"])).toBe(true);
	});

	test("does not match a larger number that contains the same digits", () => {
		expect(figureValueAppears(figure, ["12.4%の増加"])).toBe(false);
		expect(figureValueAppears(figure, ["2.45%の増加"])).toBe(false);
		expect(figureValueAppears(figure, ["12.45%の増加"])).toBe(false);
	});

	test("requires the figure unit next to the number", () => {
		expect(figureValueAppears(figure, ["2.4円の増加"])).toBe(false);
	});

	test("matches thousands-separated values against their plain form", () => {
		expect(
			figureValueAppears({ value: "1,234", unit: "円" }, [
				"価格は1,234円だった",
			]),
		).toBe(true);
	});

	test("falls back to a verbatim match when the value has no number", () => {
		expect(
			figureValueAppears({ value: "急増", unit: "" }, ["価格が急増した"]),
		).toBe(true);
	});
});

describe("over-long hook promises are normalized to their figure fragment", () => {
	test("keeps a hook that already fits and normalizes its width", () => {
		expect(normalizeHookPromise("＋2.1％の上昇", 24)).toBe("+2.1%の上昇");
	});

	test("replaces an over-long hook with the figure and unit it carries", () => {
		expect(
			normalizeHookPromise(
				"2026年9月の全国消費者物価指数は前年比+2.1%だった",
				24,
			),
		).toBe("+2.1%");
	});

	test("leaves an over-long hook without a figure unchanged so the spec schema rejects it", () => {
		const long = "あ".repeat(25);
		expect(normalizeHookPromise(long, 24)).toBe(long);
	});
});

describe("hook promises are fragments of the candidate numbers", () => {
	test("accepts a fragment that carries a candidate number", () => {
		expect(auditHookPromises(["+2.1%"], candidate.numbers)).toEqual([]);
	});

	test("compares fragments after NFKC normalization", () => {
		expect(auditHookPromises(["＋2.1％"], candidate.numbers)).toEqual([]);
	});

	test("reports a hook promise that does not come from the candidate numbers", () => {
		expect(
			formatted(auditHookPromises(["9%の増加"], candidate.numbers)),
		).toEqual(["hook_promise_not_in_candidate_numbers: 9%の増加"]);
	});
});
