import { describe, expect, test } from "bun:test";
import {
	type DialogueStyle,
	dialogueStyleReport,
	loadDialogueStyle,
	renderDialogueRepairSummary,
	renderDialogueStylePrompt,
} from "../src/domain/byosan/dialogue_style.js";

const style: DialogueStyle = {
	prompt_heading: "会話の指針:",
	guidance: [
		"1発言は{max_chars_per_utterance}字以内、{max_sentences_per_utterance}文以内。",
	],
	repair_summary: "要約: {max_chars_per_utterance}字以内。",
	targets: {
		max_chars_per_utterance: 60,
		max_sentences_per_utterance: 2,
		opening_seconds: 30,
		filler_phrases: ["その通り", "なるほど"],
	},
};

describe("dialogue style prompt", () => {
	test("expands placeholders from targets into the prompt text", () => {
		expect(renderDialogueStylePrompt(style)).toBe(
			"会話の指針:\n- 1発言は60字以内、2文以内。",
		);
	});

	test("returns an empty prompt when no guidance is configured", () => {
		expect(renderDialogueStylePrompt({ ...style, guidance: [] })).toBe("");
	});

	test("expands the repair summary from the same targets", () => {
		expect(renderDialogueRepairSummary(style)).toBe("要約: 60字以内。");
	});

	test("omits the repair summary when no guidance is configured", () => {
		expect(renderDialogueRepairSummary({ ...style, guidance: [] })).toBe("");
	});

	test("rejects a placeholder that has no numeric target", () => {
		expect(() =>
			renderDialogueStylePrompt({ ...style, guidance: ["{unknown_target}"] }),
		).toThrow("DIALOGUE_STYLE_PLACEHOLDER_UNKNOWN: unknown_target");
	});

	test("loads the configured guidance and expands every placeholder", () => {
		const configured = loadDialogueStyle();
		const prompt = renderDialogueStylePrompt(configured);
		expect(prompt.split("\n")).toHaveLength(configured.guidance.length + 1);
		expect(prompt).toContain(
			`1発言は${configured.targets.max_chars_per_utterance}字以内`,
		);
		expect(prompt).not.toMatch(/\{\w+\}/);
		expect(renderDialogueRepairSummary(configured)).not.toMatch(/\{\w+\}/);
	});
});

describe("dialogue style report", () => {
	const utterances = [
		{ speaker: "春日部つむぎ", text: "今日は、買い物の話をします。" },
		{ speaker: "ずんだもん", text: "なるほどなのだ" },
		{
			speaker: "春日部つむぎ",
			text: "その通り。値段は、一年で二割近く変わりました。物価は、そういう形で動いています。",
		},
		{ speaker: "ずんだもん", text: "なるほどなのだ、もっと聞きたいのだ" },
	];

	test("measures utterance length, sentence count, speakers and fillers", () => {
		const report = dialogueStyleReport(
			utterances,
			{ ...style.targets, max_chars_per_utterance: 30 },
			4.1,
		);
		expect(report.utterances).toBe(4);
		expect(report.speaker_utterances).toEqual({
			春日部つむぎ: 2,
			ずんだもん: 2,
		});
		expect(report.chars.max).toBe(
			"その通り。値段は、一年で二割近く変わりました。物価は、そういう形で動いています。"
				.length,
		);
		expect(report.chars.median).toBe(14);
		expect(report.over_max_chars).toBe(1);
		expect(report.max_sentences).toBe(3);
		expect(report.over_max_sentences).toBe(1);
		expect(report.filler_utterances).toEqual({ その通り: 1, なるほど: 2 });
	});

	test("counts utterances that start within the opening seconds", () => {
		const report = dialogueStyleReport(
			utterances,
			{ ...style.targets, opening_seconds: 10 },
			4.1,
		);
		expect(report.opening_utterances).toBe(3);
	});

	test("reports the schema version and rounds the mean to one decimal", () => {
		const report = dialogueStyleReport(
			[
				{ speaker: "春日部つむぎ", text: "あいうえお" },
				{ speaker: "ずんだもん", text: "あいう" },
				{ speaker: "ずんだもん", text: "あ" },
			],
			style.targets,
			4.1,
		);
		expect(report.schemaVersion).toBe("byosan_dialogue_style_report_v1");
		expect(report.chars.mean).toBe(3);
	});
});
