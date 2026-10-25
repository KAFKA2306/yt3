import { describe, expect, test } from "bun:test";
import {
	type FeatureDraftContext,
	type Json,
	featureDraftIssues,
	featureUnitSchema,
	isLocallyRepairable,
	normalizeFeatureDraft,
	repairFeatureDraftLocally,
	spliceFeatureUnit,
} from "../src/domain/byosan/feature_repair.js";
import type { ByosanFeatureSource } from "../src/domain/byosan/feature_spec.js";
import type { FeatureSpecIssue } from "../src/domain/byosan/feature_spec.js";

const sources = [
	{
		id: "boj",
		name: "日本銀行 公表資料",
		url: "https://www.boj.or.jp/",
	},
] as ByosanFeatureSource[];

const claims = [
	{
		id: "claim_cpi",
		claim: "CPIは+2.1%",
		sourceIds: ["boj"],
		status: "verified",
	},
	{
		id: "claim_gdp",
		claim: "GDPは+0.4%",
		sourceIds: ["boj"],
		status: "verified",
	},
];

function segment(index: number, extra: Json = {}): Json {
	return {
		speaker: "春日部つむぎ",
		emotion: "analytical",
		section: `章${index}`,
		headline: `見出し${index}`,
		subheadline: "副題",
		visualType: "chart",
		stats: [],
		source: "日本銀行",
		text: `場面${index}の本文です。`,
		...extra,
	};
}

function draftWith(segments: Json[], extra: Json = {}): Json {
	return {
		title: "物価の話",
		thumbnailTitle: "物価",
		thumbnail: {},
		descriptionLead: "説明です。",
		descriptionBullets: ["限定条件です。"],
		disclaimer: "投資助言ではありません。",
		hookPromises: ["+2.1%", "+0.4%"],
		noveltyQueries: ["物価 2.1%"],
		tags: ["秒算マネー"],
		claims,
		packaging: { primaryClaimId: "claim_cpi", claimIds: ["claim_cpi"] },
		segments,
		...extra,
	};
}

describe("normalizeFeatureDraft corrects format-only errors", () => {
	test("shortens an over-long hook promise to its figure fragment and records it", () => {
		const result = normalizeFeatureDraft(
			draftWith([segment(0)], {
				hookPromises: [
					"2026年9月の全国消費者物価指数は前年比+2.1%だった",
					"+0.4%",
				],
			}),
			sources,
		);
		expect(result.draft.hookPromises).toEqual(["+2.1%", "+0.4%"]);
		expect(result.corrections).toEqual([
			{
				path: "hookPromises[0]",
				rule: "hook_promise",
				from: "2026年9月の全国消費者物価指数は前年比+2.1%だった",
				to: "+2.1%",
			},
		]);
	});

	test("leaves an over-long hook without a figure untouched so validation still rejects it", () => {
		const long = "あ".repeat(25);
		const result = normalizeFeatureDraft(
			draftWith([segment(0)], { hookPromises: [long, "+0.4%"] }),
			sources,
		);
		expect(result.draft.hookPromises).toEqual([long, "+0.4%"]);
		expect(result.corrections).toEqual([]);
	});

	test("does not rewrite an impossible date or an already valid one", () => {
		const impossible = normalizeFeatureDraft(
			draftWith([segment(0)], {
				packaging: {
					primaryClaimId: "claim_cpi",
					claimIds: ["claim_cpi"],
					freshness: { claimId: "claim_cpi", eventDate: "2026-02-30" },
				},
			}),
			sources,
		);
		expect(impossible.corrections).toEqual([]);
		expect(
			(impossible.draft.packaging as Json & { freshness: Json }).freshness,
		).toEqual({ claimId: "claim_cpi", eventDate: "2026-02-30" });
	});

	test("fills a too-short segment source from the source of its first claim", () => {
		const result = normalizeFeatureDraft(
			draftWith([segment(0, { source: "", claimIds: ["claim_gdp"] })]),
			sources,
		);
		const [first] = result.draft.segments as Json[];
		expect(first?.source).toBe("日本銀行 公表資料");
		expect(result.corrections.map((correction) => correction.rule)).toEqual([
			"segment_source",
		]);
	});

	test("does not invent a source when the segment has no claim with a known source", () => {
		const result = normalizeFeatureDraft(
			draftWith([segment(0, { source: "", claimIds: ["unknown_claim"] })]),
			sources,
		);
		const [first] = result.draft.segments as Json[];
		expect(first?.source).toBe("");
		expect(result.corrections).toEqual([]);
	});

	test("keeps the sign of a figure when normalizing width", () => {
		const result = normalizeFeatureDraft(
			draftWith([segment(0)], { hookPromises: ["－2.1％", "+0.4%"] }),
			sources,
		);
		expect(result.draft.hookPromises).toEqual(["-2.1%", "+0.4%"]);
	});
});

describe("issues map to the unit that can repair them", () => {
	const context = {
		runId: "byosan_money/2026-10-24-daily",
		asOf: "2026-10-24",
		angle: "物価",
		searchQuery: "CPI",
		production: undefined,
		editorialReferencePlan: undefined,
		narrative: undefined,
		adversarialEvidence: undefined,
		activeProbes: [],
		sources,
		explanation: {
			conclusion: "物価は上がった。",
			principle: "原則です。",
			figures: [],
			check: "確認です。",
		},
		numberEvidence: { numbers: ["+2.1%"], sourceText: "" },
		bannedPhrases: [],
	} as FeatureDraftContext;

	test("treats collection counts, code-owned contracts and the whole draft as not locally repairable", () => {
		expect(isLocallyRepairable("")).toBe(false);
		expect(isLocallyRepairable("segments")).toBe(false);
		expect(isLocallyRepairable("claims")).toBe(false);
		expect(isLocallyRepairable("activeProbes")).toBe(false);
		expect(isLocallyRepairable("sources")).toBe(false);
	});

	test("reports a structurally broken draft at the draft level", () => {
		const issues = featureDraftIssues({ title: "物価の話" }, context);
		expect(issues.some((issue) => issue.path === "")).toBe(true);
	});
});

describe("spliceFeatureUnit replaces only the repaired unit", () => {});

describe("repairFeatureDraftLocally", () => {
	const issue = (path: string, code = "test_issue"): FeatureSpecIssue => ({
		code,
		details: path,
		path,
	});

	test("stops with an explicit error after the configured number of repair rounds", async () => {
		let repairs = 0;
		await expect(
			repairFeatureDraftLocally({
				draft: draftWith([segment(0)]),
				sources,
				maxRepairs: 2,
				check: () => [issue("title", "always_bad")],
				repairUnit: async () => {
					repairs += 1;
					return "まだ悪い題名";
				},
			}),
		).rejects.toThrow("BYOSAN_FEATURE_LOCAL_REPAIR_EXHAUSTED");
		expect(repairs).toBe(2);
	});

	test("refuses to patch an issue that has no locatable unit", async () => {
		let repairs = 0;
		await expect(
			repairFeatureDraftLocally({
				draft: draftWith([segment(0)]),
				sources,
				maxRepairs: 3,
				check: () => [issue("", "segment_count")],
				repairUnit: async () => {
					repairs += 1;
					return null;
				},
			}),
		).rejects.toThrow("BYOSAN_FEATURE_DRAFT_NOT_LOCALLY_REPAIRABLE");
		expect(repairs).toBe(0);
	});
});
