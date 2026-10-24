import { describe, expect, test } from "bun:test";
import {
	auditEpisode,
	auditLocalePatch,
	buildChapters,
	buildEpisodeManifest,
	buildScriptMaster,
	buildShortPlan,
	buildSubtitles,
	buildTimeline,
} from "../src/domain/episode/compiler.js";
import { parseEpisode } from "../src/domain/episode/schema.js";

const episode = parseEpisode(
	JSON.stringify({
		schema_version: 1,
		metadata: {
			title: "Test",
			description: "Desc",
			tags: ["yt3"],
			language: "ja",
		},
		fps: 30,
		sources: [{ id: "src1", url: "https://example.com" }],
		claims: [{ id: "claim1", text: "fact", source_ids: ["src1"] }],
		assets: [],
		visuals: [
			{
				id: "v1",
				type: "title",
				props: { title: "Intro" },
				elements: [],
			},
			{
				id: "v2",
				type: "comparison",
				props: { leftTitle: "A", rightTitle: "B" },
				elements: [],
			},
		],
		sections: [
			{
				id: "intro",
				title: "Introduction",
				dialogue: [
					{
						id: "d1",
						speaker: "A",
						text: "Hello",
						visual_ref: "v1",
						audio: { path: "d1.wav" },
					},
					{
						id: "d2",
						speaker: "B",
						text: "World",
						visual_ref: "v2",
						audio: { path: "d2.wav" },
					},
				],
			},
		],
		thumbnail: { lines: ["Test"], layout: {} },
		shorts: { enabled: true, max_seconds: 60 },
		locales: ["en"],
	}),
);

const timeline = buildTimeline(episode, { d1: 1000, d2: 1500 });

describe("episode canonical pipeline", () => {
	test("validates references and measured-audio timeline", () => {
		expect(auditEpisode(episode)).toEqual([]);
		expect(timeline).toEqual([
			{
				sectionId: "intro",
				dialogueId: "d1",
				startMs: 0,
				endMs: 1000,
				startFrame: 0,
				endFrame: 30,
			},
			{
				sectionId: "intro",
				dialogueId: "d2",
				startMs: 1000,
				endMs: 2500,
				startFrame: 30,
				endFrame: 75,
			},
		]);
	});

	test("derives markdown, chapters and subtitles", () => {
		expect(buildScriptMaster(episode)).toContain("A: Hello");
		expect(buildChapters(episode, timeline)).toBe("0:00 Introduction\n");
		expect(buildSubtitles(episode, timeline)).toContain("00:00:01,000");
	});

	test("rejects incomplete locale patches", () => {
		expect(
			auditLocalePatch(episode, { locale: "en", strings: {} }).some(
				(issue) => issue.code === "missing_locale_key",
			),
		).toBe(true);
	});

	test("records measured viewer-question timing in the episode manifest", () => {
		const timingEvidence = {
			viewer_question: "What changed?",
			dialogue_id: "d1",
			question_end_ms: 1_000,
			deadline_ms: 12_000,
			measurement_basis: "cumulative_measured_dialogue_audio_duration" as const,
		};
		const manifest = buildEpisodeManifest(
			episode,
			timeline,
			null,
			timingEvidence,
		);

		expect(manifest.experience_question_timing).toEqual(timingEvidence);
	});

	test("keeps a short at or below its configured duration when the first dialogue fits", () => {
		const limitedEpisode = {
			...episode,
			shorts: { enabled: true, max_seconds: 1.2 },
		};
		const shortTimeline = [
			{
				sectionId: "intro",
				dialogueId: "d1",
				startMs: 0,
				endMs: 700,
				startFrame: 0,
				endFrame: 21,
			},
			{
				sectionId: "intro",
				dialogueId: "d2",
				startMs: 700,
				endMs: 1200,
				startFrame: 21,
				endFrame: 36,
			},
		];

		const shortPlan = buildShortPlan(limitedEpisode, shortTimeline);

		expect(shortPlan.dialogue_ids).toEqual(["d1", "d2"]);
		expect(shortPlan.duration_ms).toBe(1200);
	});

	test("rejects a first dialogue that alone exceeds the short duration limit", () => {
		const limitedEpisode = {
			...episode,
			shorts: { enabled: true, max_seconds: 1.2 },
		};
		const overlongFirstDialogue = [
			{
				sectionId: "intro",
				dialogueId: "d1",
				startMs: 0,
				endMs: 1201,
				startFrame: 0,
				endFrame: 37,
			},
		];

		expect(() => buildShortPlan(limitedEpisode, overlongFirstDialogue)).toThrow(
			"first dialogue exceeds configured short duration",
		);
	});
});
