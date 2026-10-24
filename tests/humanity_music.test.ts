import { describe, expect, test } from "bun:test";
import {
	type GenerationRow,
	type MusicAuditInput,
	loadMusicConfig,
	musicAudit,
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
	tailMeanDb: -50,
	videoSeconds: 180,
	licenseText: `x ${config.yue.license_clause} y`,
	cover: { tool: "codex-imagegen", prompt: "p", sha256: "cc" },
	coverSha256: "cc",
	lyricsGenerated: true,
});

describe("humanity music ledger", () => {});

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

	test("fails integrity when the ending is not faded", () => {
		const input = { ...passing(), tailMeanDb: -18 };
		expect(musicAudit(input, config).music_integrity?.status).not.toBe("PASS");
	});

	test("fails integrity when generation was truncated", () => {
		const input = passing();
		input.result.truncated = { semantic: true };
		expect(musicAudit(input, config).music_integrity?.status).not.toBe("PASS");
	});

	test("fails integrity when the song is too short", () => {
		const input = passing();
		input.song = song("a", "2026-10-20T00:00:00Z", 60);
		input.videoSeconds = 60;
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
