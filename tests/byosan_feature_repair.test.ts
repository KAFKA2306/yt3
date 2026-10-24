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

	test("normalizes full-width digits and percent signs in stat values", () => {
		const result = normalizeFeatureDraft(
			draftWith([
				segment(0, {
					stats: [
						{
							label: "CPI",
							value: "２．１％",
							detail: "前年比",
							color: "cyan",
						},
					],
				}),
			]),
			sources,
		);
		const [first] = result.draft.segments as Json[];
		expect((first?.stats as Json[])[0]?.value).toBe("2.1%");
		expect(result.corrections).toEqual([
			{
				path: "segments[0].stats[0].value",
				rule: "stat_value",
				from: "２．１％",
				to: "2.1%",
			},
		]);
	});

	test("converts a Japanese or slash-separated event date to YYYY-MM-DD", () => {
		const japanese = normalizeFeatureDraft(
			draftWith([segment(0)], {
				packaging: {
					primaryClaimId: "claim_cpi",
					claimIds: ["claim_cpi"],
					freshness: { claimId: "claim_cpi", eventDate: "2026年10月24日" },
				},
			}),
			sources,
		);
		expect(japanese.draft.packaging).toEqual({
			primaryClaimId: "claim_cpi",
			claimIds: ["claim_cpi"],
			freshness: { claimId: "claim_cpi", eventDate: "2026-10-24" },
		});
		expect(japanese.corrections.map((correction) => correction.rule)).toEqual([
			"event_date",
		]);

		const slashed = normalizeFeatureDraft(
			draftWith([segment(0)], {
				packaging: {
					primaryClaimId: "claim_cpi",
					claimIds: ["claim_cpi"],
					freshness: { claimId: "claim_cpi", eventDate: "2026/9/4" },
				},
			}),
			sources,
		);
		expect(
			(slashed.draft.packaging as Json & { freshness: Json }).freshness,
		).toEqual({ claimId: "claim_cpi", eventDate: "2026-09-04" });
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

	test("trims claim ids to the limit while keeping packaging claims first", () => {
		const ids = [
			"c1",
			"c2",
			"primary",
			"c3",
			"c4",
			"c5",
			"claim_cpi_extra",
			"c6",
		];
		const result = normalizeFeatureDraft(
			draftWith([segment(0, { claimIds: ids })], {
				packaging: { primaryClaimId: "primary", claimIds: ["primary"] },
			}),
			sources,
		);
		const [first] = result.draft.segments as Json[];
		expect(first?.claimIds).toEqual(["c1", "c2", "primary", "c3", "c4", "c5"]);
		expect(result.corrections).toEqual([
			{
				path: "segments[0].claimIds",
				rule: "claim_ids",
				from: ids,
				to: ["c1", "c2", "primary", "c3", "c4", "c5"],
			},
		]);
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
		candidateNumbers: ["+2.1%"],
		bannedPhrases: [],
	} as FeatureDraftContext;

	test("treats a segment, claim, or top-level field as locally repairable", () => {
		expect(isLocallyRepairable("segments[3]")).toBe(true);
		expect(isLocallyRepairable("claims[0]")).toBe(true);
		expect(isLocallyRepairable("title")).toBe(true);
		expect(isLocallyRepairable("hookPromises")).toBe(true);
	});

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

	test("resolves a repair unit schema for indexed segments and claims", () => {
		expect(featureUnitSchema("segments[3]")).toBeDefined();
		expect(featureUnitSchema("claims[0]")).toBeDefined();
		expect(featureUnitSchema("segments")).toBeUndefined();
	});
});

describe("spliceFeatureUnit replaces only the repaired unit", () => {
	test("changes one segment and keeps every other segment object", () => {
		const draft = draftWith([segment(0), segment(1), segment(2)]);
		const original = (draft.segments as Json[]).slice();
		const next = spliceFeatureUnit(
			draft,
			"segments[1]",
			segment(1, { text: "直した本文です。" }),
		);
		const segments = next.segments as Json[];
		expect(segments[1]?.text).toBe("直した本文です。");
		expect(segments[0]).toBe(original[0]);
		expect(segments[2]).toBe(original[2]);
	});

	test("keeps the original claim id even when the repaired claim carries another one", () => {
		const draft = draftWith([segment(0)]);
		const next = spliceFeatureUnit(draft, "claims[1]", {
			id: "renamed",
			claim: "GDPは+0.5%",
			sourceIds: ["boj"],
			status: "verified",
		});
		const repaired = (next.claims as Json[])[1];
		expect(repaired?.id).toBe("claim_gdp");
		expect(repaired?.claim).toBe("GDPは+0.5%");
	});

	test("takes the id from the repaired claim when the original claim had none", () => {
		const draft = draftWith([segment(0)], {
			claims: [{ claim: "CPIは+2.1%", sourceIds: ["boj"], status: "verified" }],
		});
		const next = spliceFeatureUnit(draft, "claims[0]", {
			id: "claim_cpi",
			claim: "CPIは+2.1%",
			sourceIds: ["boj"],
			status: "verified",
		});
		expect((next.claims as Json[])[0]?.id).toBe("claim_cpi");
	});

	test("replaces a top-level field as a whole", () => {
		const next = spliceFeatureUnit(
			draftWith([segment(0)]),
			"title",
			"新しい題名",
		);
		expect(next.title).toBe("新しい題名");
	});
});

describe("repairFeatureDraftLocally", () => {
	const issue = (path: string, code = "test_issue"): FeatureSpecIssue => ({
		code,
		details: path,
		path,
	});

	test("repairs only the failing segment and stops once the draft passes", async () => {
		const draft = draftWith([segment(0), segment(1), segment(2)]);
		const calls: Array<{ unit: string; codes: string[] }> = [];
		const result = await repairFeatureDraftLocally({
			draft,
			sources,
			maxRepairs: 3,
			check: (current) => {
				const segments = current.segments as Json[];
				return segments[1]?.text === "直した本文です。"
					? []
					: [issue("segments[1]", "segment_text")];
			},
			repairUnit: async (unit, issues) => {
				calls.push({ unit, codes: issues.map((item) => item.code) });
				return segment(1, { text: "直した本文です。" });
			},
		});
		expect(calls).toEqual([{ unit: "segments[1]", codes: ["segment_text"] }]);
		expect((result.draft.segments as Json[])[0]).toEqual(segment(0));
		expect((result.draft.segments as Json[])[2]).toEqual(segment(2));
		expect(result.rounds).toEqual([
			{ round: 1, units: ["segments[1]"], issueCodes: ["segment_text"] },
		]);
	});

	test("calls one repair per distinct unit with that unit's issues only", async () => {
		const calls: Array<{ unit: string; codes: string[] }> = [];
		let pending = [
			issue("segments[0]", "a"),
			issue("title", "b"),
			issue("segments[0]", "c"),
		];
		await repairFeatureDraftLocally({
			draft: draftWith([segment(0)]),
			sources,
			maxRepairs: 1,
			check: () => pending,
			repairUnit: async (unit, issues) => {
				calls.push({ unit, codes: issues.map((item) => item.code) });
				pending = [];
				return unit === "title" ? "題名" : segment(0);
			},
		});
		expect(calls).toEqual([
			{ unit: "segments[0]", codes: ["a", "c"] },
			{ unit: "title", codes: ["b"] },
		]);
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

	test("performs no repair when the limit is zero", async () => {
		let repairs = 0;
		await expect(
			repairFeatureDraftLocally({
				draft: draftWith([segment(0)]),
				sources,
				maxRepairs: 0,
				check: () => [issue("title", "bad")],
				repairUnit: async () => {
					repairs += 1;
					return "題名";
				},
			}),
		).rejects.toThrow("BYOSAN_FEATURE_LOCAL_REPAIR_EXHAUSTED");
		expect(repairs).toBe(0);
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
