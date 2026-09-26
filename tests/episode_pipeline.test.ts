import { describe, expect, test } from "bun:test";
import {
	applyLocalePatch,
	auditEpisode,
	auditLocalePatch,
	buildChapters,
	buildEpisodeManifest,
	buildScriptMaster,
	buildShortPlan,
	buildSubtitles,
	buildTimeline,
	extractTranslatableStrings,
} from "../src/domain/episode/compiler.js";
import {
	buildRemotionInput,
	buildRemotionRenderCommand,
	buildRemotionWorkspaceFiles,
} from "../src/domain/episode/remotion_workspace.js";
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

	test("extracts and applies a complete locale patch", () => {
		const strings = extractTranslatableStrings(episode);
		const patch = {
			locale: "en",
			strings: Object.fromEntries(
				Object.entries(strings).map(([key, value]) => [key, `EN:${value}`]),
			),
		};
		expect(auditLocalePatch(episode, patch)).toEqual([]);
		const localized = applyLocalePatch(episode, patch);
		expect(localized.metadata.title).toBe("EN:Test");
		expect(localized.sections[0]?.dialogue[0]?.text).toBe("EN:Hello");
	});

	test("rejects incomplete locale patches", () => {
		expect(
			auditLocalePatch(episode, { locale: "en", strings: {} }).some(
				(issue) => issue.code === "missing_locale_key",
			),
		).toBe(true);
	});

	test("creates a source-linked 9:16 short and deterministic manifest", () => {
		const shortPlan = buildShortPlan(episode, timeline);
		expect(shortPlan.aspect_ratio).toBe("9:16");
		expect(shortPlan.dialogue_ids).toEqual(["d1", "d2"]);
		expect(shortPlan.section_ids).toEqual(["intro"]);
		const first = buildEpisodeManifest(episode, timeline, shortPlan);
		const second = buildEpisodeManifest(episode, timeline, shortPlan);
		expect(first).toEqual(second);
	});

	test("builds main and short Remotion inputs with ten fixed templates", () => {
		const main = buildRemotionInput(episode, timeline);
		const short = buildRemotionInput(
			episode,
			timeline,
			buildShortPlan(episode, timeline),
		);
		expect(main.width).toBe(1920);
		expect(short.width).toBe(1080);
		const workspace = buildRemotionWorkspaceFiles();
		const entry = workspace["entry.tsx"] ?? "";
		for (const template of [
			"title",
			"two-column",
			"comparison",
			"timeline",
			"number-highlight",
			"quote",
			"source-card",
			"image",
			"terminal",
			"github",
		]) {
			expect(entry).toContain(`"${template}"`);
		}
	});

	test("builds an argv-based Remotion command", () => {
		const command = buildRemotionRenderCommand(
			"/tmp/input.json",
			"/tmp/out.mp4",
		);
		expect(command.slice(0, 5)).toEqual([
			"bun",
			"node_modules/@remotion/cli/remotion-cli.js",
			"render",
			"entry.tsx",
			"Episode",
		]);
		expect(command).toContain("--props=/tmp/input.json");
	});
});
