import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import { z } from "zod";
import type { AuditCheck } from "./types.js";

export const ConfigSchema = z.object({
	yue: z.object({
		dir: z.string(),
		hf_home: z.string(),
		python: z.string(),
		script: z.string(),
		license_file: z.string(),
		license_clause: z.string(),
		min_free_vram_mib: z.number(),
		snapshot_dir: z.string(),
	}),
	output_dir: z.string(),
	style_base: z.string(),
	temperature: z.number(),
	playlist: z.object({
		file: z.string(),
		audio_file: z.string(),
		bitrate: z.string(),
	}),
	rating: z.object({ min: z.number(), max: z.number() }),
	axes: z.record(z.string(), z.array(z.string())),
	structure: z.array(z.string()),
	lines_per_section: z.number(),
	lyrics_rule: z.string(),
	run: z.object({ bucket: z.string(), name_prefix: z.string() }),
	cover: z.object({ file: z.string(), size: z.string(), prompt: z.string() }),
	video: z.object({
		file: z.string(),
		width: z.number(),
		height: z.number(),
		fps: z.number(),
		crf: z.number(),
		audio_bitrate: z.string(),
	}),
	thumbnail: z.object({
		file: z.string(),
		width: z.number(),
		height: z.number(),
		quality: z.number(),
	}),
	audit: z.object({
		min_seconds: z.number(),
		max_tail_mean_db: z.number(),
		tail_seconds: z.number(),
		duration_tolerance_seconds: z.number(),
	}),
	metadata: z.object({
		title_suffix: z.string(),
		tags: z.array(z.string()),
		description: z.string(),
		credit: z.string(),
		ai_disclosure: z.string(),
	}),
	rights_declaration: z.string(),
	youtube_playlist: z.object({
		title: z.string(),
		description: z.string(),
		privacy: z.enum(["public", "unlisted", "private"]),
		ready_attempts: z.number(),
		ready_interval_ms: z.number(),
	}),
});
export type MusicConfig = z.infer<typeof ConfigSchema>;

export const LedgerRowSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("generation"),
		id: z.string(),
		at: z.string(),
		cell: z.record(z.string(), z.string()),
		title: z.string(),
		seed: z.number(),
		audio: z.string(),
		audio_sha256: z.string(),
		seconds: z.number(),
		truncated: z.boolean(),
	}),
	z.object({
		kind: z.literal("rating"),
		id: z.string(),
		at: z.string(),
		score: z.number(),
		note: z.string(),
	}),
	z.object({
		kind: z.literal("playlist"),
		at: z.string(),
		playlist_id: z.string(),
		playlist_url: z.string(),
	}),
	z.object({
		kind: z.literal("publication"),
		id: z.string(),
		at: z.string(),
		video_id: z.string(),
		video_url: z.string(),
		playlist_url: z.string(),
	}),
]);
export type LedgerRow = z.infer<typeof LedgerRowSchema>;
export type GenerationRow = Extract<LedgerRow, { kind: "generation" }>;

export const YOUTUBE_WATCH_URL = "https://www.youtube.com/watch?v=";
export const YOUTUBE_PLAYLIST_URL = "https://www.youtube.com/playlist?list=";

export function loadMusicConfig(root: string): MusicConfig {
	return ConfigSchema.parse(
		yaml.load(
			fs.readFileSync(path.join(root, "config/music/humanity.yaml"), "utf-8"),
		),
	);
}

export function parseLedger(text: string): LedgerRow[] {
	return text
		.split("\n")
		.filter(Boolean)
		.map((line) => LedgerRowSchema.parse(JSON.parse(line)));
}

export function scoresOf(rows: LedgerRow[]): Map<string, number> {
	return new Map(
		rows.flatMap((row) => (row.kind === "rating" ? [[row.id, row.score]] : [])),
	);
}

export function generations(rows: LedgerRow[]): GenerationRow[] {
	return rows.flatMap((row) => (row.kind === "generation" ? [row] : []));
}

export function rankedSongs(rows: LedgerRow[]): GenerationRow[] {
	const scores = scoresOf(rows);
	return generations(rows).sort(
		(a, b) =>
			(scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) ||
			b.at.localeCompare(a.at),
	);
}

export function playlistText(
	songs: GenerationRow[],
	outputDir: string,
	audioFile: string,
): string {
	const lines = songs.flatMap((song) => [
		`#EXTINF:${Math.round(song.seconds)},${song.title}`,
		path.relative(outputDir, path.join(path.dirname(song.audio), audioFile)),
	]);
	return `#EXTM3U\n${lines.join("\n")}\n`;
}

export function rarestCell(
	rows: LedgerRow[],
	axes: Record<string, string[]>,
	random: () => number,
): Record<string, string> {
	const cells = generations(rows).map((row) => row.cell);
	return Object.fromEntries(
		Object.entries(axes).map(([axis, values]) => {
			const counts = values.map(
				(value) => cells.filter((cell) => cell[axis] === value).length,
			);
			const min = Math.min(...counts);
			const rarest = values.filter((_, i) => counts[i] === min);
			return [axis, rarest[Math.floor(random() * rarest.length)] as string];
		}),
	);
}

export function fillTemplate(
	template: string,
	values: Record<string, string>,
): string {
	return template.replaceAll(
		/\{(\w+)\}/g,
		(_, key: string) => values[key] ?? "",
	);
}

export type MusicAuditInput = {
	result: {
		status?: string;
		identity?: unknown;
		weights?: unknown;
		truncated?: Record<string, boolean>;
	};
	requestSeed: number | undefined;
	song: GenerationRow;
	actualAudioSha256: string;
	tailMeanDb: number;
	videoSeconds: number;
	licenseText: string;
	cover: { tool?: string; prompt?: string; sha256?: string } | undefined;
	coverSha256: string;
	lyricsGenerated: boolean;
};

function check(
	name: string,
	description: string,
	failures: string[],
): AuditCheck {
	return {
		name,
		description,
		status: failures.length === 0 ? "PASS" : "QUALITY_FAIL",
		details: failures.length === 0 ? "ok" : failures.join("; "),
		critical: true,
		type: "DETERMINISTIC",
	};
}

export function musicAudit(
	input: MusicAuditInput,
	config: MusicConfig,
): Record<string, AuditCheck> {
	const { result, song, cover } = input;
	const provenance = [
		result.status === "complete" ? "" : "result.status is not complete",
		result.identity ? "" : "model identity missing",
		result.weights ? "" : "weights record missing",
		input.requestSeed === song.seed ? "" : "request seed differs from ledger",
		input.licenseText.includes(config.yue.license_clause)
			? ""
			: "individual creator clause missing from MODEL_LICENSE",
	];
	const integrity = [
		input.actualAudioSha256 === song.audio_sha256
			? ""
			: "audio sha256 differs from ledger",
		result.truncated && Object.values(result.truncated).some(Boolean)
			? "generation truncated"
			: "",
		song.seconds >= config.audit.min_seconds
			? ""
			: `shorter than ${config.audit.min_seconds}s`,
		input.tailMeanDb <= config.audit.max_tail_mean_db
			? ""
			: `ending is not faded (${input.tailMeanDb} dB)`,
		Math.abs(input.videoSeconds - song.seconds) <=
		config.audit.duration_tolerance_seconds
			? ""
			: "video and audio durations differ",
	];
	const visual = [
		cover?.tool ? "" : "cover tool missing",
		cover?.prompt ? "" : "cover prompt missing",
		cover?.sha256 && cover.sha256 === input.coverSha256
			? ""
			: "cover sha256 mismatch",
	];
	const rights = [
		input.lyricsGenerated ? "" : "lyrics were not generated in this run",
		config.rights_declaration ? "" : "rights declaration missing",
	];
	return {
		music_provenance: check(
			"music_provenance",
			"Model, weights, seed and license basis are recorded",
			provenance.filter(Boolean),
		),
		music_integrity: check(
			"music_integrity",
			"Audio hash, completeness, length, ending and video duration",
			integrity.filter(Boolean),
		),
		visual_provenance: check(
			"visual_provenance",
			"Cover image tool, prompt and hash are recorded",
			visual.filter(Boolean),
		),
		music_rights: check(
			"music_rights",
			"Lyrics are newly generated and the individual-creator declaration exists",
			rights.filter(Boolean),
		),
	};
}
