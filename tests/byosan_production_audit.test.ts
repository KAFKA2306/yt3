import { describe, expect, test } from "bun:test";
import type { ByosanFeatureSegment } from "../src/domain/byosan/feature_spec.js";
import {
	layoutCueSpans,
	planSpeechSegments,
} from "../src/domain/byosan/production_audit.js";

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

const stat = {
	label: "全国CPIコア",
	value: "+2.1%",
	detail: "2026年9月・前年同月比",
	color: "cyan" as const,
};

describe("planSpeechSegments", () => {
	test("splits a long segment at sentence boundaries and keeps stats on the first part only", () => {
		const parts = planSpeechSegments(
			[
				segment({
					text: "一つ目の文は長さをそろえてあります。二つ目の文も同じくらいの長さにそろえています。",
					stats: [stat],
				}),
			],
			{ maxSceneSeconds: 10, charsPerSecond: 4 },
		);
		expect(parts).toHaveLength(2);
		expect(parts[0]?.stats).toEqual([stat]);
		expect(parts[1]?.stats).toEqual([]);
	});

	test("splits a segment without sentence boundaries into parts within the limit", () => {
		const text = "句点のない長い台詞がそのまま続く".repeat(6);
		const parts = planSpeechSegments([segment({ text })], {
			maxSceneSeconds: 5,
			charsPerSecond: 4,
		});
		expect(parts.map((part) => part.text).join("")).toBe(text);
		expect(parts.every((part) => Array.from(part.text).length <= 20)).toBe(
			true,
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

	test("shares a window too short for the minimum cue length evenly instead of failing", () => {
		const spans = layoutCueSpans([1, 1, 1], 0, 2, 0.84);
		expect(spans).toHaveLength(3);
		expect(spans[0]?.start).toBe(0);
		expect(spans[spans.length - 1]?.end).toBe(2);
	});
});
