import { describe, expect, test } from "bun:test";
import {
	type GenerationRow,
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
	cell: { time: "夜", season: "春の雨" },
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
	videoSeconds: 180,
	licenseText: `x ${config.yue.license_clause} y`,
	cover: { tool: "codex-imagegen", prompt: "p", sha256: "cc" },
	coverSha256: "cc",
	lyricsGenerated: true,
});

describe("humanity music style", () => {
	test("every style_template placeholder names an axis", () => {
		const placeholders = [...config.style_template.matchAll(/\{(\w+)\}/g)].map(
			(match) => match[1] as string,
		);
		expect(placeholders.every((key) => key in config.axes)).toBe(true);
	});
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

	test("fails visual provenance when the cover hash differs", () => {
		const input = { ...passing(), coverSha256: "dd" };
		expect(musicAudit(input, config).visual_provenance?.status).not.toBe(
			"PASS",
		);
	});
});
