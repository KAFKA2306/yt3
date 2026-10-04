import { describe, expect, test } from "bun:test";
import {
	buildCanonicalEpisode,
	elapsedGenerationSeconds,
	transcriptSimilarity,
} from "../src/domain/episode/production.js";

const script = {
	title: "本編",
	description: "説明",
	total_duration: 0,
	lines: [
		{ speaker: "春日部つむぎ", text: "最初の行", duration: 0 },
		{ speaker: "ずんだもん", text: "次の行", duration: 0 },
	],
};

const metadata = {
	title: "正本動画",
	thumbnail_title: "正本動画",
	description: "説明",
	tags: ["canonical"],
};

describe("canonical episode production", () => {
	test("measures elapsed generation wall time and rejects invalid clock ranges", () => {
		expect(elapsedGenerationSeconds(250, 1_750)).toBe(1.5);
		expect(() => elapsedGenerationSeconds(2, 1)).toThrow(
			"generation finished before it started",
		);
		expect(() => elapsedGenerationSeconds(Number.NaN, 1)).toThrow(
			"generation timestamps must be finite",
		);
	});

	test("preserves research source and claim provenance", () => {
		const episode = buildCanonicalEpisode({
			script,
			metadata,
			news: [
				{
					title: "Primary",
					summary: "Evidence backed claim",
					url: "https://example.com/source",
				},
			],
			fps: 25,
			audioPaths: ["audio/000.wav", "audio/001.wav"],
			locales: ["en"],
		});
		expect(episode.sources).toHaveLength(1);
		expect(episode.claims).toHaveLength(1);
		expect(episode.claims[0]?.source_ids).toEqual([episode.sources[0]?.id]);
		expect(episode.visuals[1]?.source_ref).toBe(episode.sources[0]?.id);
		expect(episode.locales).toEqual(["en"]);
	});

	test("deduplicates repeated research URLs without losing a valid claim source", () => {
		const episode = buildCanonicalEpisode({
			script,
			metadata,
			news: [
				{ title: "A", summary: "A", url: "https://example.com/source" },
				{ title: "B", summary: "B", url: "https://example.com/source" },
			],
			fps: 25,
			audioPaths: ["audio/000.wav", "audio/001.wav"],
		});
		expect(episode.sources).toHaveLength(1);
		expect(episode.claims).toHaveLength(1);
	});

	test("requires one audio path per dialogue", () => {
		expect(() =>
			buildCanonicalEpisode({
				script,
				metadata,
				news: [],
				fps: 25,
				audioPaths: ["audio/000.wav"],
			}),
		).toThrow("audio path count");
	});

	test("normalizes punctuation while still rejecting material ASR errors", () => {
		expect(
			transcriptSimilarity("レンダリング、確認。", "レンダリング確認"),
		).toBe(1);
		expect(transcriptSimilarity("本編の要点", "完全に違う文章")).toBeLessThan(
			0.82,
		);
	});
});
