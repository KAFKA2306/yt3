import { describe, expect, test } from "bun:test";
import {
	type ScriptDraft,
	assertUnprivileged,
	irodoriArgs,
	loadPool,
	loadYawaConfig,
	pickEntry,
	similarity,
	validateDraft,
	yawaAudit,
} from "../src/domain/yawa_daily.js";

const root = process.cwd();
const config = loadYawaConfig(root);
const pool = loadPool(root, config);

function draft(overrides: Partial<ScriptDraft> = {}): ScriptDraft {
	return {
		title: "雨の夜のおやすみ",
		hook: "今日もお疲れさまでした。雨の音と一緒にゆっくり休みましょう。",
		voice_caption: "夜の静かな部屋で、耳元で囁く落ち着いた大人の女性の声。",
		cover_scene: "雨の夜の窓辺に置かれた小さなランプと、湯気の立つマグカップ。",
		adult_characters_confirmed: true,
		segments: Array.from(
			{ length: config.script.min_segments },
			(_, i) => `ゆっくり息を吐きましょう。${i}`,
		),
		...overrides,
	};
}

describe("yawa daily pool", () => {
	test("picks the least used entry and cycles", () => {
		const first = pickEntry(pool, []);
		const second = pickEntry(pool, [first.id]);
		expect(second.id).not.toBe(first.id);
		const all = pool.map((e) => e.id);
		expect(pickEntry(pool, all).id).toBe(first.id);
	});
	test("pool only contains eligible entries", () => {
		expect(pool.length).toBeGreaterThan(0);
		expect(pool.every((e) => e.eligible)).toBe(true);
	});
});

describe("yawa daily safety", () => {
	test("accepts a clean draft", () => {
		expect(validateDraft(draft(), config)).toEqual([]);
	});
	test("rejects banned and age-ambiguous terms", () => {
		const bad = draft({
			segments: draft().segments.map(() => "制服の少女です。"),
		});
		expect(
			validateDraft(bad, config).some((f) => f.startsWith("banned term")),
		).toBe(true);
	});
	test("rejects wrong segment count and long segments", () => {
		expect(
			validateDraft(draft({ segments: ["短い"] }), config).length,
		).toBeGreaterThan(0);
		const long = draft().segments.map(() =>
			"あ".repeat(config.script.max_segment_chars + 1),
		);
		expect(
			validateDraft(draft({ segments: long }), config).length,
		).toBeGreaterThan(0);
	});
	test("refuses to run as root", () => {
		expect(() => assertUnprivileged(0, [])).toThrow("must not run as root");
	});
});

describe("yawa daily tts backend", () => {
	test("builds an irodori command with a pinned HF_HOME", () => {
		const call = irodoriArgs(config, "こんばんは", "囁く声", "/tmp/x.wav");
		expect(call.command).toContain("--hf-checkpoint");
		expect(call.env.HF_HOME).toBe(config.tts.hf_home);
	});
	test("switching backend is a config value", () => {
		const call = irodoriArgs(
			{ ...config, tts: { ...config.tts, backend: "irodori-v4-large" } },
			"こんばんは",
			"囁く声",
			"/tmp/x.wav",
		);
		expect(call.command).toContain("Aratako/Irodori-TTS-v4-Large");
	});
	test("unknown backend fails loudly", () => {
		expect(() =>
			irodoriArgs(
				{ ...config, tts: { ...config.tts, backend: "nope" } },
				"a",
				"b",
				"c",
			),
		).toThrow("unknown tts backend");
	});
});

describe("yawa daily audit", () => {
	const base = {
		draft: draft(),
		entry: pool[0],
		scriptGeneratedInRun: true,
		ttsRecord: {
			backend: "irodori-v4.1-small",
			checkpoint: "x",
			seed: config.tts.seed,
		},
		audioSeconds: 600,
		videoSeconds: 600,
		tailMeanDb: -50,
		asrSimilarity: 0.9,
		cover: { tool: "codex-imagegen", prompt: "p", sha256: "abc" },
		coverSha256: "abc",
	};
	test("passes a complete run", () => {
		const result = yawaAudit(base as never, config);
		expect(Object.values(result).every((c) => c.status === "PASS")).toBe(true);
		expect(Object.keys(result)).toContain("tts_provenance");
		expect(Object.keys(result)).toContain("audio_integrity");
	});
	test("fails on low ASR similarity and missing ASR", () => {
		expect(
			yawaAudit({ ...base, asrSimilarity: 0.1 } as never, config)
				.audio_integrity?.status,
		).toBe("QUALITY_FAIL");
		expect(
			yawaAudit({ ...base, asrSimilarity: undefined } as never, config)
				.audio_integrity?.status,
		).toBe("QUALITY_FAIL");
	});
	test("similarity ignores punctuation", () => {
		expect(similarity("おやすみ、なさい。", "おやすみなさい")).toBe(1);
	});
});
