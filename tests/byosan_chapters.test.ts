import { describe, expect, test } from "bun:test";
import {
	type ByosanChaptersConfig,
	type ByosanDescriptionInput,
	buildByosanDescription,
	classifyByosanSources,
	formatChapterTimestamp,
	planByosanChapters,
} from "../src/domain/byosan/description.js";

const config: ByosanChaptersConfig = {
	max_title_chars: 34,
	min_chapter_seconds: 10,
	min_chapters: 3,
	max_chapters: 15,
	headings: {
		key_points: "この動画の要点",
		evidence: "根拠と限界",
		chapters: "チャプター",
		primary_sources: "一次資料",
		reference_sources: "参考（数値の根拠ではない）",
	},
	claim_status_labels: {
		verified: "確認済みの数値",
		derived_with_caveat: "派生値（前提付き）",
		analyst_estimate_not_company_non_gaap:
			"アナリストの推計（会社の公式値ではない）",
	},
};

const citedSource = {
	id: "cited",
	name: "第一ライフ",
	url: "https://example.com/cited",
};

const uncitedSource = {
	id: "index",
	name: "日本銀行",
	url: "https://example.com/index",
};

const sources: ByosanDescriptionInput["sources"] = [citedSource, uncitedSource];

const claims: ByosanDescriptionInput["claims"] = [
	{ claim: "数値を支える主張です。", sourceIds: ["cited"], status: "verified" },
];

describe("planByosanChapters", () => {
	test("groups consecutive short turns into chapters of at least the minimum length", () => {
		const turns = Array.from({ length: 12 }, (_, index) => ({
			headline: `話題${index}`,
			duration: 7.5,
		}));
		expect(planByosanChapters(turns, config)).toEqual([
			{ start: 0, title: "話題0" },
			{ start: 15, title: "話題2" },
			{ start: 30, title: "話題4" },
			{ start: 45, title: "話題6" },
			{ start: 60, title: "話題8" },
			{ start: 75, title: "話題10" },
		]);
	});

	test("folds a short trailing remainder into the previous chapter", () => {
		expect(
			planByosanChapters(
				[
					{ headline: "結論", duration: 20 },
					{ headline: "数字", duration: 20 },
					{ headline: "確認", duration: 20 },
					{ headline: "出典", duration: 4 },
				],
				config,
			),
		).toEqual([
			{ start: 0, title: "結論" },
			{ start: 20, title: "数字" },
			{ start: 40, title: "確認" },
		]);
	});

	test("uses the headline of the first scene in each interval as the chapter title", () => {
		expect(
			planByosanChapters(
				[
					{ headline: "結論", duration: 16 },
					{ headline: "数字の内訳", duration: 17 },
					{ headline: "原理の説明", duration: 20 },
				],
				config,
			),
		).toEqual([
			{ start: 0, title: "結論" },
			{ start: 16, title: "数字の内訳" },
			{ start: 33, title: "原理の説明" },
		]);
	});

	test("merges consecutive scenes that share a headline into one chapter", () => {
		expect(
			planByosanChapters(
				[
					{ headline: "数字の内訳", duration: 8 },
					{ headline: "数字の内訳", duration: 9 },
					{ headline: "原理の説明", duration: 20 },
					{ headline: "出典の確認", duration: 20 },
				],
				config,
			),
		).toEqual([
			{ start: 0, title: "数字の内訳" },
			{ start: 17, title: "原理の説明" },
			{ start: 37, title: "出典の確認" },
		]);
	});

	test("lets a short interval absorb the following scenes until it reaches the minimum length", () => {
		expect(
			planByosanChapters(
				[
					{ headline: "A", duration: 12 },
					{ headline: "B", duration: 4 },
					{ headline: "C", duration: 12 },
					{ headline: "D", duration: 12 },
				],
				config,
			),
		).toEqual([
			{ start: 0, title: "A" },
			{ start: 12, title: "B" },
			{ start: 28, title: "D" },
		]);
	});

	test("folds a short first interval into the chapter after it, keeping the 0:00 start", () => {
		expect(
			planByosanChapters(
				[
					{ headline: "A", duration: 4 },
					{ headline: "B", duration: 12 },
					{ headline: "C", duration: 12 },
					{ headline: "D", duration: 12 },
				],
				config,
			),
		).toEqual([
			{ start: 0, title: "A" },
			{ start: 16, title: "C" },
			{ start: 28, title: "D" },
		]);
	});

	test("merges the narrowest adjacent pair until the chapter count is within max_chapters", () => {
		expect(
			planByosanChapters(
				[
					{ headline: "A", duration: 20 },
					{ headline: "B", duration: 20 },
					{ headline: "C", duration: 10 },
					{ headline: "D", duration: 10 },
					{ headline: "E", duration: 20 },
				],
				{ ...config, max_chapters: 3 },
			),
		).toEqual([
			{ start: 0, title: "A" },
			{ start: 40, title: "C" },
			{ start: 60, title: "E" },
		]);
	});

	test("throws when fewer chapters than min_chapters remain", () => {
		expect(() =>
			planByosanChapters([{ headline: "A", duration: 30 }], config),
		).toThrow("BYOSAN_CHAPTERS_TOO_FEW");
	});

	test("throws when a chapter title exceeds max_title_chars", () => {
		expect(() =>
			planByosanChapters(
				[
					{ headline: "長すぎる題名", duration: 20 },
					{ headline: "ab", duration: 20 },
					{ headline: "cd", duration: 20 },
				],
				{ ...config, max_title_chars: 3 },
			),
		).toThrow("BYOSAN_CHAPTER_TITLE_TOO_LONG");
	});
});

describe("formatChapterTimestamp", () => {
	test("formats minutes and seconds, adding hours only when needed", () => {
		expect(formatChapterTimestamp(0)).toBe("0:00");
		expect(formatChapterTimestamp(65.9)).toBe("1:05");
		expect(formatChapterTimestamp(3723)).toBe("1:02:03");
	});
});

describe("classifyByosanSources", () => {
	test("separates sources cited by claims from sources no claim references", () => {
		const { primary, reference } = classifyByosanSources(sources, claims);
		expect(primary.map((source) => source.id)).toEqual(["cited"]);
		expect(reference.map((source) => source.id)).toEqual(["index"]);
	});
});

describe("buildByosanDescription", () => {
	const input: ByosanDescriptionInput = {
		descriptionLead: "導入文です。",
		descriptionBullets: ["要点1です。"],
		disclaimer: "免責です。",
		sources,
		claims,
	};

	test("lists cited sources as primary and uncited sources as reference under their own headings", () => {
		expect(
			buildByosanDescription(
				input,
				[
					{ headline: "A", duration: 20 },
					{ headline: "B", duration: 20 },
					{ headline: "C", duration: 20 },
				],
				config,
			),
		).toBe(
			[
				"導入文です。",
				"この動画の要点\n・要点1です。",
				"根拠と限界\n・確認済みの数値: 数値を支える主張です。（出典: 第一ライフ）",
				"チャプター\n0:00 A\n0:20 B\n0:40 C",
				"一次資料\n第一ライフ\nhttps://example.com/cited",
				"参考（数値の根拠ではない）\n日本銀行\nhttps://example.com/index",
				"※免責です。",
			].join("\n\n"),
		);
	});

	test("states each claim's status with its caveat and epistemic boundary in the evidence section", () => {
		const description = buildByosanDescription(
			{
				...input,
				claims: [
					{
						claim: "推計の数値です。",
						sourceIds: ["cited"],
						status: "analyst_estimate_not_company_non_gaap",
						caveat: "前提に依存する",
						epistemicBoundary: "発表主体側の値です。",
					},
				],
			},
			[{ headline: "A", duration: 60 }],
			{ ...config, min_chapters: 1 },
		);
		expect(description).toContain(
			"根拠と限界\n・アナリストの推計（会社の公式値ではない）: 推計の数値です。（出典: 第一ライフ） 限界: 前提に依存する 発表主体側の値です。",
		);
	});

	test("omits the reference heading when every source is cited", () => {
		const description = buildByosanDescription(
			{ ...input, sources: [citedSource] },
			[
				{ headline: "A", duration: 20 },
				{ headline: "B", duration: 20 },
				{ headline: "C", duration: 20 },
			],
			config,
		);
		expect(description).not.toContain("参考（数値の根拠ではない）");
		expect(description).toContain("一次資料");
	});
});
