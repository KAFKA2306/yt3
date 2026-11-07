import { describe, expect, test } from "bun:test";
import {
	assertUnprivileged,
	buildDescription,
	buildTags,
	buildTitle,
	chooseSelection,
	draftSegments,
	loadPool,
	loadYawaConfig,
	pickLeast,
	preparationAction,
	type ReferenceCandidate,
	resolveBeat,
	type ScriptDraft,
	type Selection,
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
const SHAPE = "単峰";
const SEG = {
	text: "こんばんは",
	chapter: resolveBeat(config, "導入", "yawa-t"),
};

function chaptersOf(texts: string[], shape = SHAPE): ScriptDraft["chapters"] {
	const names = config.arc.shapes[shape] ?? [];
	return names.map((name, index) => ({
		name,
		segments: texts.filter((_, i) => i % names.length === index),
	}));
}

function draft(overrides: Partial<ScriptDraft> = {}): ScriptDraft {
	return {
		title: "雨の夜のおやすみ",
		hook: "今日もお疲れさまでした。雨の音と一緒にゆっくり休みましょう。",
		cover_scene: "雨の夜の窓辺に置かれた小さなランプと、湯気の立つマグカップ。",
		adult_characters_confirmed: true,
		shape: SHAPE,
		chapters: chaptersOf(
			Array.from(
				{ length: config.script.min_segments },
				(_, i) => `ゆっくり息を吐きましょう。${i}`,
			),
		),
		...overrides,
	};
}

describe("yawa daily safety", () => {
	test("accepts a clean draft", () => {
		expect(validateDraft(draft(), config)).toEqual([]);
	});
	test("rejects banned and age-ambiguous terms", () => {
		const bad = draft({
			chapters: chaptersOf(
				Array(config.script.min_segments).fill("制服の少女です。"),
			),
		});
		expect(
			validateDraft(bad, config).some((f) => f.startsWith("banned term")),
		).toBe(true);
	});
	test("rejects wrong segment count and long segments", () => {
		expect(
			validateDraft(draft({ chapters: chaptersOf(["短い"]) }), config).length,
		).toBeGreaterThan(0);
		const long = Array(config.script.min_segments).fill(
			"あ".repeat(config.script.max_segment_chars + 1),
		);
		expect(
			validateDraft(draft({ chapters: chaptersOf(long) }), config).length,
		).toBeGreaterThan(0);
	});
	test("refuses to run as root", () => {
		expect(() => assertUnprivileged(0, [])).toThrow("must not run as root");
	});
});

describe("yawa daily arc", () => {
	const selection: Selection = {
		id: "SCR-001",
		shape: SHAPE,
		axes: Object.fromEntries(
			Object.entries(config.axes).map(([axis, options]) => [
				axis,
				options[0] as string,
			]),
		),
		title_form: 0,
	};
	test("a beat sets its pace and caption on the same reference, stable per run", () => {
		const beat = config.arc.beats.山場;
		const peak = resolveBeat(config, "山場", "yawa-2026-11-02");
		expect(peak).toEqual(resolveBeat(config, "山場", "yawa-2026-11-02"));
		expect(peak.duration_scale).toBeGreaterThanOrEqual(
			beat?.duration_scale[0] ?? 0,
		);
		expect(peak.duration_scale).toBeLessThanOrEqual(
			beat?.duration_scale[1] ?? 0,
		);
		const call = segmentCall(
			config,
			{ text: "あ", chapter: peak },
			REF,
			"/o.wav",
		);
		expect(call.command).toContain(String(peak.duration_scale));
		expect(call.command).toContain(`${config.voice.caption}${peak.style}`);
		expect(call.command).toContain(REF);
	});
	test("every shape is accepted, ends in a descent, and a mismatch is rejected", () => {
		for (const [shape, names] of Object.entries(config.arc.shapes)) {
			const texts = Array.from(
				{ length: config.script.min_segments },
				(_, i) => `あ${i}`,
			);
			const d = draft({ shape, chapters: chaptersOf(texts, shape) });
			expect(validateDraft(d, config)).toEqual([]);
			expect(draftSegments(d, config, "yawa-t").length).toBe(texts.length);
			expect(["沈み", "締め"]).toContain(names[names.length - 1] as string);
		}
		const bad = draft({ chapters: [{ name: "導入", segments: ["あ"] }] });
		expect(
			validateDraft(bad, config).some((f) => f.startsWith("chapters")),
		).toBe(true);
		expect(validateDraft(draft({ shape: "none" }), config)[0]).toContain(
			"unknown shape",
		);
	});
	test("selection rotates through unused options and feeds the title and tags", () => {
		expect(pickLeast(["a", "b", "c"], ["a", "b", "a"], "s")).toBe("c");
		const next = chooseSelection(
			config,
			"SCR-001",
			[selection, selection],
			"yawa-x",
		);
		expect(next.shape).not.toBe(selection.shape);
		expect(next.axes.place).not.toBe(selection.axes.place);
		const meta = {
			title: "月あかりの調合室で",
			hook: "x".repeat(12),
			cover_scene: "x".repeat(24),
			adult_characters_confirmed: true as const,
		};
		expect(buildTitle(meta, config, selection)).toContain(
			selection.axes.narrator_role as string,
		);
		expect(buildTags(config, selection)).toContain(
			selection.axes.place as string,
		);
	});
});

describe("yawa daily voice reference", () => {
	test("every segment is generated from the reference clip, never caption-only", () => {
		const call = segmentCall(config, SEG, REF, "/tmp/x.wav");
		expect(call.command).toContain("--ref-wav");
		expect(call.command).toContain(REF);
		expect(call.command).not.toContain("--ref-wavs");
	});
	test("selects the most intelligible candidate", () => {
		const candidates: ReferenceCandidate[] = [
			{ seed: 101, file: "a", asr_similarity: 0.7 },
			{ seed: 202, file: "b", asr_similarity: 0.9 },
			{ seed: 303, file: "c", asr_similarity: 0.85 },
		];
		expect(selectReference(candidates).seed).toBe(202);
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

describe("yawa daily tts backend", () => {
	test("unknown backend fails loudly", () => {
		expect(() =>
			segmentCall(
				{ ...config, tts: { ...config.tts, backend: "nope" } },
				SEG,
				REF,
				"c",
			),
		).toThrow("unknown tts backend");
	});
});

describe("yawa daily audit", () => {
	const selection: Selection = {
		id: "SCR-001",
		shape: SHAPE,
		axes: Object.fromEntries(
			Object.entries(config.axes).map(([axis, options]) => [
				axis,
				options[0] as string,
			]),
		),
		title_form: 0,
	};
	const base = {
		draft: draft(),
		selection,
		metadata: {
			title: buildTitle(draft(), config, selection),
			tags: buildTags(config, selection),
		},
		entry: pool[0],
		scriptGeneratedInRun: true,
		ttsRecord: {
			backend: "comfyui-irodori",
			checkpoint: "x",
			seed: config.tts.seed,
			reference_sha256: "ref1",
		},
		referenceSha256: "ref1",
		audioSeconds: 600,
		videoSeconds: 600,
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
	test("fails on metadata that drifts from the selection", () => {
		const fail = (patch: object) =>
			Object.values(yawaAudit({ ...base, ...patch } as never, config)).some(
				(c) => c.status !== "PASS",
			);
		expect(fail({ metadata: { ...base.metadata, title: "x" } })).toBe(true);
		expect(fail({ selection: { ...selection, shape: "other" } })).toBe(true);
	});
});
