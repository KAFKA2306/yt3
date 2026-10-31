import { describe, expect, test } from "bun:test";
import {
	assertUnprivileged,
	buildDescription,
	loadPool,
	loadYawaConfig,
	preparationAction,
	type ReferenceCandidate,
	type ScriptDraft,
	segmentCall,
	selectReference,
	validateDraft,
	yawaAudit,
} from "../src/domain/yawa_daily.js";
import { fixtureAt } from "./fixtures/fixture_at.js";

const root = process.cwd();
const config = loadYawaConfig(root);
const pool = loadPool(root, config);
const REF = "/tmp/ref.wav";

function draft(overrides: Partial<ScriptDraft> = {}): ScriptDraft {
	return {
		title: "雨の夜のおやすみ",
		hook: "今日もお疲れさまでした。雨の音と一緒にゆっくり休みましょう。",
		cover_scene: "雨の夜の窓辺に置かれた小さなランプと、湯気の立つマグカップ。",
		adult_characters_confirmed: true,
		segments: Array.from(
			{ length: config.script.min_segments },
			(_, i) => `ゆっくり息を吐きましょう。${i}`,
		),
		...overrides,
	};
}

describe("yawa daily pool", () => {});

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

describe("yawa daily voice reference", () => {
	test("every segment is generated from the reference clip, never caption-only", () => {
		const call = segmentCall(config, "こんばんは", "囁く声", REF, "/tmp/x.wav");
		expect(call.command).toContain("--ref-wavs");
		expect(call.command).toContain(REF);
		expect(call.command).not.toContain("--no-ref");
	});
	test("selects the most intelligible candidate", () => {
		const candidates: ReferenceCandidate[] = [
			{ seed: 101, file: "a", asr_similarity: 0.7 },
			{ seed: 202, file: "b", asr_similarity: 0.9 },
			{ seed: 303, file: "c", asr_similarity: 0.85 },
		];
		expect(selectReference(candidates, config).seed).toBe(202);
	});
	test("breaks ties by lower seed", () => {
		const candidates: ReferenceCandidate[] = [
			{ seed: 303, file: "c", asr_similarity: 0.8 },
			{ seed: 101, file: "a", asr_similarity: 0.8 },
		];
		expect(selectReference(candidates, config).seed).toBe(101);
	});
	test("fails when no candidate passes", () => {
		expect(() =>
			selectReference([{ seed: 101, file: "a", asr_similarity: 0.1 }], config),
		).toThrow("no reference candidate passed");
	});
});

describe("yawa daily existing runs", () => {
	test("never regenerates a published run", () => {
		expect(
			preparationAction({
				publishVerified: true,
				finalMixExists: true,
				referenceExists: false,
			}),
		).toBe("skip_verified");
	});
	test("refuses to add a reference to audio made without one", () => {
		expect(
			preparationAction({
				publishVerified: false,
				finalMixExists: true,
				referenceExists: false,
			}),
		).toBe("refuse_legacy");
	});
});

describe("yawa daily metadata", () => {
	test("description keeps the AI disclosure and the inspiration credit", () => {
		const inspiration = fixtureAt(pool, 0);
		const text = buildDescription(draft(), inspiration, config, 430);
		expect(text).toContain(config.metadata.ai_disclosure);
		expect(text).toContain(inspiration.url);
		expect(text).toContain("年上の成人の女性");
	});
});

describe("yawa daily voice identity", () => {});

describe("yawa daily tts backend", () => {
	test("unknown backend fails loudly", () => {
		expect(() =>
			segmentCall(
				{ ...config, tts: { ...config.tts, backend: "nope" } },
				"a",
				"b",
				REF,
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
			reference_sha256: "ref1",
		},
		referenceSha256: "ref1",
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
		expect(Object.keys(result)).toContain("voice_reference");
	});
	test("fails when segments were not generated from the recorded reference", () => {
		const result = yawaAudit(
			{ ...base, referenceSha256: "other" } as never,
			config,
		);
		expect(result.voice_reference?.status).toBe("QUALITY_FAIL");
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
});
