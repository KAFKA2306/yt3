import { describe, expect, test } from "bun:test";
import type { ByosanFeatureSegment } from "../src/domain/byosan/feature_spec.js";
import {
	evaluateOpeningCatch,
	layoutCueSpans,
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

describe("splitSpeechText", () => {});

describe("planSpeechSegments", () => {
	const longSegment = segment({
		text: "一つ目の文は長さをそろえてあります。二つ目の文も同じくらいの長さにそろえています。",
		stats: [
			{
				label: "全国CPIコア",
				value: "+2.1%",
				detail: "2026年9月・前年同月比",
				color: "cyan",
			},
		],
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
	test("reports a cue shorter than the centisecond minimum", () => {
		expect(minimumCueSecondsAtAssPrecision([{ start: 1, end: 1.83 }])).toBe(
			0.83,
		);
	});
});

describe("layoutCueSpans", () => {
	test("never produces overlapping cues and always covers the window", () => {
		const spans = layoutCueSpans([12, 3, 1, 7], 10, 16, 0.84);
		for (let index = 1; index < spans.length; index++) {
			expect(spans[index]?.start).toBe(spans[index - 1]?.end);
		}
		expect(spans[0]?.start).toBe(10);
		expect(spans[spans.length - 1]?.end).toBe(16);
		for (const span of spans) {
			expect(span.end - span.start).toBeGreaterThanOrEqual(0.84 - 1e-9);
		}
	});

	test("throws when the window cannot hold every cue at the minimum length", () => {
		expect(() => layoutCueSpans([1, 1, 1], 0, 2, 0.84)).toThrow(
			"BYOSAN_CUE_WINDOW_TOO_SHORT",
		);
	});
});
