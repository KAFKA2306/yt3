import { describe, expect, test } from "bun:test";
import type { ByosanFeatureSegment } from "../src/domain/byosan/feature_spec.js";
import {
	evaluateOpeningCatch,
	minimumCueSecondsAtAssPrecision,
	planSpeechSegments,
	splitSpeechText,
} from "../src/domain/byosan/production_audit.js";

const claims = [
	{
		id: "c1",
		claim:
			"提供資料では、2026年9月の全国CPIコアは前年比＋2.1％で、8月の＋1.7％から上昇率が拡大した。",
	},
	{ id: "c7", claim: "物価上昇はエネルギー以外にも広がった。" },
];

const segment = (
	overrides: Partial<ByosanFeatureSegment> = {},
): ByosanFeatureSegment => ({
	speaker: "春日部つむぎ",
	emotion: "reveal",
	section: "導入",
	headline: "広がりと持続性を分ける",
	subheadline: "前年同月比で比べる",
	visualType: "stat",
	stats: [],
	source: "提供資料",
	text: "結論から。資料を合わせた分析では、物価上昇は広がっている。",
	claimIds: ["c1"],
	...overrides,
});

const catchInput = (openingSegments: ByosanFeatureSegment[]) => ({
	primaryClaimId: "c1",
	claims,
	openingSegments,
});

describe("evaluateOpeningCatch", () => {
	test("accepts a half-width opening that restates the claim figure", () => {
		const result = evaluateOpeningCatch(
			catchInput([segment({ text: "全国CPIコアは前年比+2.1%でした。" })]),
		);
		expect(result.passed).toBe(true);
		expect(result.evidence.match).toEqual({
			segment_index: 0,
			field: "text",
			figure: "+2.1%",
		});
	});

	test("accepts the spelled-out percent and plus sign", () => {
		const result = evaluateOpeningCatch(
			catchInput([segment({ text: "前年比プラス2.1パーセントの上昇。" })]),
		);
		expect(result.passed).toBe(true);
	});

	test("rejects a figure that only shares digits with the claim figure", () => {
		const result = evaluateOpeningCatch(
			catchInput([segment({ text: "全国CPIは前年比+12.1%でした。" })]),
		);
		expect(result.passed).toBe(false);
	});

	test("rejects an opening that does not carry the primary claim", () => {
		const result = evaluateOpeningCatch(
			catchInput([segment({ text: "前年比+2.1%です。", claimIds: ["c7"] })]),
		);
		expect(result.passed).toBe(false);
	});

	test("accepts a figure carried only by a stat card and records the field", () => {
		const result = evaluateOpeningCatch(
			catchInput([
				segment({
					text: "全国CPIが上がりました。",
					stats: [
						{
							label: "全国CPIコア",
							value: "+2.1%",
							detail: "2026年9月・前年同月比",
							color: "cyan",
						},
					],
				}),
			]),
		);
		expect(result.passed).toBe(true);
		expect(result.evidence.match).toEqual({
			segment_index: 0,
			field: "stats.value",
			figure: "+2.1%",
		});
	});

	test("throws when the primary claim is not in the claim list", () => {
		expect(() =>
			evaluateOpeningCatch({
				primaryClaimId: "c9",
				claims,
				openingSegments: [segment({ text: "前年比+2.1%です。" })],
			}),
		).toThrow("BYOSAN_PRIMARY_CLAIM_MISSING: c9");
	});
});

describe("splitSpeechText", () => {
	test("keeps a text within the limit whole", () => {
		expect(splitSpeechText("結論から。短い。", 20)).toEqual([
			"結論から。短い。",
		]);
	});

	test("cuts at sentence ends into balanced parts within the limit", () => {
		const text =
			"一つ目の文です。二つ目の文です。三つ目の文です。四つ目の文です。";
		const parts = splitSpeechText(text, 25);
		expect(parts).toEqual([
			"一つ目の文です。二つ目の文です。",
			"三つ目の文です。四つ目の文です。",
		]);
		expect(parts.join("")).toBe(text);
	});

	test("adds parts when no sentence boundary keeps every part within the limit", () => {
		const first = "あ".repeat(10) + "。";
		const second = "い".repeat(60) + "。";
		const third = "う".repeat(40) + "。";
		expect(splitSpeechText(first + second + third, 65)).toEqual([
			first,
			second,
			third,
		]);
	});

	test("throws when a single sentence exceeds the limit", () => {
		expect(() =>
			splitSpeechText("切れ目のない一つの長い文がずっと続いていきます", 5),
		).toThrow("BYOSAN_SCENE_SPLIT_IMPOSSIBLE");
	});
});

describe("planSpeechSegments", () => {
	const longSegment = segment({
		text: "一つ目の文は長さをそろえてあります。二つ目の文も同じくらいの長さにそろえています。",
		chapter: "導入章",
		stats: [
			{
				label: "全国CPIコア",
				value: "+2.1%",
				detail: "2026年9月・前年同月比",
				color: "cyan",
			},
		],
	});

	test("passes segments within the limit through unchanged", () => {
		const short = segment({ text: "短い台詞です。" });
		expect(
			planSpeechSegments([short], {
				maxSceneSeconds: 10,
				charsPerSecond: 4,
				minCueSeconds: 0.8,
			}),
		).toEqual([short]);
	});

	test("splits a long segment and inherits its speaker, emotion, headline, and claims", () => {
		const parts = planSpeechSegments([longSegment], {
			maxSceneSeconds: 10,
			charsPerSecond: 4,
			minCueSeconds: 0.8,
		});
		expect(parts).toHaveLength(2);
		for (const part of parts) {
			expect(part.speaker).toBe(longSegment.speaker);
			expect(part.emotion).toBe(longSegment.emotion);
			expect(part.headline).toBe(longSegment.headline);
			expect(part.claimIds).toEqual(longSegment.claimIds);
			expect(part.text.length).toBeLessThanOrEqual(40);
		}
	});

	test("keeps the stat card and chapter on the first part only", () => {
		const [first, second] = planSpeechSegments([longSegment], {
			maxSceneSeconds: 10,
			charsPerSecond: 4,
			minCueSeconds: 0.8,
		});
		expect(first?.stats).toEqual(longSegment.stats);
		expect(first?.chapter).toBe("導入章");
		expect(second?.stats).toEqual([]);
		expect(second?.chapter).toBeUndefined();
	});

	test("throws when a split part would be shorter than the minimum cue", () => {
		expect(() =>
			planSpeechSegments([longSegment], {
				maxSceneSeconds: 10,
				charsPerSecond: 4,
				minCueSeconds: 100,
			}),
		).toThrow("BYOSAN_SCENE_TOO_SHORT");
	});
});

describe("minimumCueSecondsAtAssPrecision", () => {
	test("measures cue length in ASS centiseconds so float error does not fail a 0.84 cue", () => {
		expect(
			minimumCueSecondsAtAssPrecision([
				{ start: 1, end: 1.84 },
				{ start: 2, end: 4 },
			]),
		).toBe(0.84);
	});

	test("reports a cue shorter than the centisecond minimum", () => {
		expect(minimumCueSecondsAtAssPrecision([{ start: 1, end: 1.83 }])).toBe(
			0.83,
		);
	});
});
