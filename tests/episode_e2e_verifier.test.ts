import { describe, expect, test } from "bun:test";
import type {
	EpisodeShortPlan,
	EpisodeTimelineItem,
} from "../src/domain/episode/compiler.js";
import {
	assertDeterministicFontContract,
	assertEnglishLocale,
	assertMediaContract,
	assertShortContract,
	assertTemplateCoverage,
	assertTimelineContract,
	buildRepresentativeFrameCommand,
} from "../src/domain/episode/e2e_verifier.js";
import {
	type RemotionRenderInput,
	buildRemotionWorkspaceFiles,
} from "../src/domain/episode/remotion_workspace.js";

const templates = [
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
];

function renderInput(): RemotionRenderInput {
	return {
		fps: 10,
		width: 1920,
		height: 1080,
		durationInFrames: 39,
		items: templates.map((template, index) => ({
			id: `d${index + 1}`,
			startFrame: index * 3,
			endFrame: index * 3 + 3,
			speaker: "KAFKA",
			text: template,
			subtitle: template,
			shortRole: null,
			visual: { type: template, props: {} },
		})),
	};
}

describe("episode E2E verifier", () => {
	test("requires all ten templates", () => {
		expect(() => assertTemplateCoverage(renderInput())).not.toThrow();
		const missing = renderInput();
		missing.items = missing.items.slice(0, -1);
		expect(() => assertTemplateCoverage(missing)).toThrow("github");
	});

	test("enforces three distinct measured durations and contiguous timeline", () => {
		const timeline: EpisodeTimelineItem[] = [
			{
				sectionId: "s",
				dialogueId: "a",
				startMs: 0,
				endMs: 300,
				startFrame: 0,
				endFrame: 3,
			},
			{
				sectionId: "s",
				dialogueId: "b",
				startMs: 300,
				endMs: 700,
				startFrame: 3,
				endFrame: 7,
			},
			{
				sectionId: "s",
				dialogueId: "c",
				startMs: 700,
				endMs: 1200,
				startFrame: 7,
				endFrame: 12,
			},
		];
		expect(() => assertTimelineContract(timeline, 10)).not.toThrow();
	});

	test("requires hook highlight CTA provenance in Short", () => {
		const plan: EpisodeShortPlan = {
			aspect_ratio: "9:16",
			dialogue_ids: ["a", "b", "c"],
			section_ids: ["s"],
			hook_dialogue_id: "a",
			highlight_dialogue_ids: ["b", "c"],
			cta: "watch",
			duration_ms: 1200,
		};
		const input: RemotionRenderInput = {
			fps: 10,
			width: 1080,
			height: 1920,
			durationInFrames: 12,
			items: [
				{
					id: "a",
					startFrame: 0,
					endFrame: 3,
					speaker: "K",
					text: "a",
					subtitle: "a",
					shortRole: "HOOK",
					visual: { type: "title", props: {} },
				},
				{
					id: "b",
					startFrame: 3,
					endFrame: 7,
					speaker: "K",
					text: "b",
					subtitle: "b",
					shortRole: "HIGHLIGHT",
					visual: { type: "comparison", props: {} },
				},
				{
					id: "c",
					startFrame: 7,
					endFrame: 12,
					speaker: "K",
					text: "c",
					subtitle: "c",
					shortRole: "CTA",
					visual: { type: "timeline", props: {} },
				},
			],
		};
		expect(() => assertShortContract(plan, input)).not.toThrow();
	});

	test("fails English locale when Japanese remains", () => {
		expect(() => assertEnglishLocale({ title: "Render check" })).not.toThrow();
		expect(() => assertEnglishLocale({ title: "レンダリング確認" })).toThrow(
			"Japanese text",
		);
	});

	test("pins and explicitly loads the self-hosted CJK font", () => {
		expect(() =>
			assertDeterministicFontContract(buildRemotionWorkspaceFiles()),
		).not.toThrow();
	});

	test("enforces dimensions and 100ms audio/video drift", () => {
		expect(
			assertMediaContract(
				{
					width: 1920,
					height: 1080,
					videoDurationMs: 3900,
					audioDurationMs: 3950,
					formatDurationMs: 3950,
				},
				{ width: 1920, height: 1080 },
			),
		).toEqual({ driftMs: 50 });
		expect(() =>
			assertMediaContract(
				{
					width: 1920,
					height: 1080,
					videoDurationMs: 3900,
					audioDurationMs: 4050,
					formatDurationMs: 4050,
				},
				{ width: 1920, height: 1080 },
			),
		).toThrow("drift");
	});

	test("extracts representative PNG frames with argv only", () => {
		const command = buildRepresentativeFrameCommand(
			"input.mp4",
			"frame.png",
			0.7,
		);
		expect(command[0]).toBe("ffmpeg");
		expect(command).toContain("frame.png");
		expect(command).toContain("0.700");
	});
});
