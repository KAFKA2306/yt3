import { describe, expect, test } from "bun:test";
import {
	assertUnprivileged,
	buildDescription,
	capabilities,
	flattenPerformances,
	irodoriCall,
	loadYawaConfig,
	preparationAction,
	ScriptDraftSchema,
	validateDraft,
	yawaAudit,
} from "../src/domain/yawa_daily.js";

const config = loadYawaConfig(process.cwd());
const tools = capabilities(config);

function draft(overrides: Record<string, unknown> = {}) {
	return ScriptDraftSchema.parse({
		title: "雨音の修理工房",
		description: "閉店後の工房で、二人が小さな音の正体を探す。",
		tags: ["ASMR", "音声ドラマ"],
		voices: [{ id: "worker", caption: "明るく、少し掠れた声" }],
		performances: [
			{
				voice_id: "worker",
				text: "この音、さっきと少し違うね。",
				acting: "気づきに弾みをつける",
			},
		],
		cover_prompt: "雨の工房で小さな時計を調べる成人二人。",
		thumbnail_prompt: "時計の内部を覗き込む二人の手元。",
		production: {
			tts_backend: config.tts.backend,
			image_tool: "codex-imagegen",
			order: ["image", "audio"],
			motion: {
				zoom_start: 1,
				zoom_end: 1.12,
				x_start: 0.4,
				x_end: 0.6,
				y_start: 0.5,
				y_end: 0.5,
			},
		},
		...overrides,
	});
}

describe("Yawa creative handoff", () => {
	test("loads open-ended creative guidance separately from runtime settings", () => {
		expect(Object.keys(config.creative).length).toBeGreaterThan(0);
		expect(config.tts.device).toBe("cpu");
	});

	test("accepts flat performances and an independently chosen chapter structure", () => {
		expect(draft().performances).toHaveLength(1);
		const chapterDraft = draft({
			performances: undefined,
			chapters: [
				{
					name: "時計の裏側",
					performances: [
						{ voice_id: "worker", text: "歯車がひとつ、逆向きに回っている。" },
					],
				},
			],
		});
		expect(chapterDraft.chapters?.[0]?.name).toBe("時計の裏側");
		const mixedDraft = draft({
			chapters: [
				{ performances: [{ voice_id: "worker", text: "章の中の台詞。" }] },
			],
		});
		expect(flattenPerformances(mixedDraft)).toHaveLength(2);
	});

	test("does not impose story patterns or segment character limits", () => {
		const longPerformance = { voice_id: "worker", text: "あ".repeat(300) };
		const value = draft({
			title: "深海の図書館",
			performances: [longPerformance],
		});
		expect(validateDraft(value, config, tools)).toEqual([]);
	});

	test("checks only publication metadata limits and available tools", () => {
		expect(
			validateDraft(draft({ title: "x".repeat(101) }), config, tools),
		).toContain("title exceeds YouTube's 100-character limit");
		expect(
			validateDraft(
				draft({ production: { ...draft().production, image_tool: "missing" } }),
				config,
				tools,
			),
		).toContain("image tool unavailable: missing");
	});
});

describe("Yawa TTS handoff", () => {
	test("supports reference-free calls without recording a seed", () => {
		const call = irodoriCall(config, {
			backendId: config.tts.backend,
			text: "今夜は遠回りして帰ろう。",
			caption: "少し高めで、明るく率直な声。",
			outputWav: "/tmp/yawa.wav",
			durationScale: 1.12,
			device: "cpu",
		});
		expect(call.command).toContain("--no-ref");
		expect(call.command).not.toContain("--seed");
		expect(call.command).toContain("--duration-scale");
	});

	test("passes an optional per-work reference", () => {
		const call = irodoriCall(config, {
			backendId: config.tts.backend,
			text: "返事を待っていたんだ。",
			caption: "乾いた低めの声。",
			referenceWav: "/tmp/voice.wav",
			outputWav: "/tmp/yawa.wav",
		});
		expect(call.command).toContain("--ref-wavs");
		expect(call.command).toContain("/tmp/voice.wav");
		expect(call.command).not.toContain("--no-ref");
	});
});

describe("Yawa technical completion", () => {
	test("never regenerates a verified publication", () => {
		expect(preparationAction({ publishVerified: true })).toBe("skip_verified");
		expect(preparationAction({ publishVerified: false })).toBe("prepare");
	});

	test("keeps the independent audit limited to playable deliverables", () => {
		const audit = yawaAudit(
			{
				audioSeconds: 240,
				videoSeconds: 240.5,
				coverReadable: true,
				thumbnailReadable: true,
				metadataValid: true,
			},
			config,
		);
		expect(Object.values(audit).every((item) => item.status === "PASS")).toBe(
			true,
		);
		expect(Object.keys(audit)).not.toContain("creative_similarity");
	});

	test("refuses root execution", () => {
		expect(() => assertUnprivileged(0, [])).toThrow("must not run as root");
	});
});

test("metadata retains factual disclosures without fixed creative title or lead", () => {
	const text = buildDescription(draft(), config);
	expect(text).toContain(config.metadata.ai_disclosure);
	expect(text).toContain(config.metadata.rights_declaration);
	expect(text).not.toContain("再生時間:");
});
