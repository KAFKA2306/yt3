import { describe, expect, test } from "bun:test";
import {
	ConfigSchema,
	type GenerationRow,
	HumanityJizuraPlanSchema,
	loadMusicConfig,
	type MusicAuditInput,
	musicAudit,
	publishedSeconds,
} from "../src/domain/humanity_music.js";

const config = loadMusicConfig(process.cwd());

const song = (id: string, at: string, seconds = 180): GenerationRow => ({
	kind: "generation",
	id,
	at,
	cell: { direction: "A song-specific sound selected for its own idea" },
	title: id,
	seed: 7,
	audio: `/x/${id}/song/audio.flac`,
	audio_sha256: "aa",
	seconds,
	truncated: false,
});

const passing = (): MusicAuditInput => ({
	result: { status: "complete", identity: {}, weights: {}, truncated: {} },
	requestSeed: 7,
	song: song("a", "2026-10-20T00:00:00Z"),
	actualAudioSha256: "aa",
	videoAudio: { sample_rate: 48000, channels: 2 },
	videoSeconds: 180,
	licenseText: `x ${config.yue.license_clause} y`,
	pv: { tool: "remotion", sha256: "cc" },
	videoSha256: "cc",
	lyricsGenerated: true,
});

describe("humanity music ledger", () => {
	test("counts only the seconds of published songs", () => {
		const rows = [
			song("a", "2026-10-20T00:00:00Z", 100),
			song("b", "2026-10-21T00:00:00Z", 200),
			{
				kind: "publication" as const,
				id: "a",
				at: "2026-10-20T01:00:00Z",
				video_id: "v",
				video_url: "u",
				playlist_url: "p",
			},
		];
		expect(publishedSeconds(rows)).toBe(100);
	});
});

describe("humanity music audit", () => {
	test("passes a complete run with every critical check", () => {
		const audit = musicAudit(passing(), config);
		expect(Object.values(audit).every((c) => c.status === "PASS")).toBe(true);
		expect(Object.values(audit).every((c) => c.critical)).toBe(true);
	});

	test("fails integrity when the audio hash changed", () => {
		const input = { ...passing(), actualAudioSha256: "bb" };
		expect(musicAudit(input, config).music_integrity?.status).not.toBe("PASS");
	});

	test("fails integrity when generation was truncated", () => {
		const input = passing();
		input.result.truncated = { semantic: true };
		expect(musicAudit(input, config).music_integrity?.status).not.toBe("PASS");
	});

	test("fails provenance when the individual creator clause is missing", () => {
		const input = { ...passing(), licenseText: "CC BY-NC only" };
		expect(musicAudit(input, config).music_provenance?.status).not.toBe("PASS");
	});

	test("fails visual provenance when the video hash differs", () => {
		const input = { ...passing(), videoSha256: "dd" };
		expect(musicAudit(input, config).visual_provenance?.status).not.toBe(
			"PASS",
		);
	});

	test("accepts renderer-neutral provenance without a JIZURA version", () => {
		const input = passing();
		expect(musicAudit(input, config).visual_provenance?.status).toBe("PASS");
	});
});

describe("humanity narrative label config", () => {
	test("accepts a renderer config without JIZURA-only settings", () => {
		const rendererNeutral = ConfigSchema.parse({
			...config,
			pv: {
				file: config.pv.file,
				record: config.pv.record,
				renderer: "remotion",
			},
		});
		expect(rendererNeutral.pv).toMatchObject({ renderer: "remotion" });
	});

	test("configures jacket thumbnail generation and story description fields", () => {
		expect(config.thumbnail.image_tool?.command).toBe("codex-imagegen");
		expect(config.metadata.title_suffix).toContain("雨晴はうの人類観測所");
		expect(config.metadata.description).toContain("{concept}");
		expect(config.metadata.description).toContain("{story}");
		expect(config.metadata.description).toContain("{characters}");
		expect(Object.keys(config.use_case_playlists).sort()).toEqual([
			"q1_action_boost",
			"q2_focus_boost",
			"q3_daily_flow",
			"q4_night_reset",
		]);
	});
});

describe("song-specific JIZURA arc", () => {
	test("requires lyric-anchored clue and climax plus a transformation palette", () => {
		const plan = {
			theme_id: "pop",
			style_id: "specimen",
			mood_id: "calm",
			unify: true,
			typeset: true,
			palette: { accent: "#F2A65A", ghost_a: "#8CC9D8", ghost_b: "#E3A0A9" },
			visual_arc: {
				opening_hook: "カーテンの端が",
				motif: "朝の湯気とカップ",
				motif_layout_id: "xcPaperCup",
				clue_lyric: "湯を沸かす音",
				climax_lyric: "今日のわたしが",
				transformation: "湯気の向こうから朝の光が差す",
			},
			climax_palette: { bg: "#48343C", accent: "#F2B36D" },
			rationale: "曲固有の湯気の手掛かりを最後のサビで光へ変える。",
		};
		expect(HumanityJizuraPlanSchema.parse(plan).visual_arc.climax_lyric).toBe(
			"今日のわたしが",
		);
		expect(() =>
			HumanityJizuraPlanSchema.parse({
				...plan,
				visual_arc: { ...plan.visual_arc, clue_lyric: "missing" },
				climax_palette: { ...plan.climax_palette, bg: "not-a-color" },
			}),
		).toThrow();
	});
});
