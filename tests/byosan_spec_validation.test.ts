import { describe, expect, test } from "bun:test";
import type { Explanation } from "../src/domain/byosan/explanation.js";
import { auditFeatureSpecAgainstExplanation } from "../src/domain/byosan/explanation_contract.js";
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
const articleText = "2026年9月の消費者物価指数は前年比+2.1%";

type SegmentFixture = {
	text: string;
	headline?: string;
	verificationRole?: string;
};

function specWith(
	segments: SegmentFixture[],
	thumbnailLead = "上昇",
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
		claims: [],
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
				articleText,
			),
		).toEqual([]);
	});

	test("reports a number with no source in the explanation or the input articles", () => {
		const issues = auditFeatureSpecAgainstExplanation(
			specWith([
				{
					text: `${conclusion}前年比+2.1%で47%増えた。`,
					verificationRole: "landing",
				},
			]),
			explanation,
			articleText,
		);
		expect(formatted(issues)).toEqual(["unsourced_number: 47"]);
		expect(issues[0]?.path).toBe("segments[0]");
	});

	test("accepts a bare number that the evidence article states", () => {
		const issues = auditFeatureSpecAgainstExplanation(
			specWith([
				...grounded,
				{
					text: `${conclusion}1982と1990の回を除くのだ。`,
					verificationRole: "landing",
				},
			]),
			explanation,
			`${articleText}1982年と1990年の反発を除外した。`,
		);
		expect(issues).toEqual([]);
	});

	test("does not match a number that only occurs inside a longer number", () => {
		const issues = auditFeatureSpecAgainstExplanation(
			specWith([
				...grounded,
				{ text: `${conclusion}4回を除くのだ。`, verificationRole: "landing" },
			]),
			explanation,
			`${articleText}14%の上昇`,
		);
		expect(formatted(issues)).toEqual(["unsourced_number: 4"]);
	});

	test("checks numbers in thumbnail and description fields too", () => {
		const issues = auditFeatureSpecAgainstExplanation(
			specWith(grounded, "3倍"),
			explanation,
			articleText,
		);
		expect(formatted(issues)).toEqual(["unsourced_number: 3"]);
		expect(issues[0]?.path).toBe("thumbnail");
	});
});
