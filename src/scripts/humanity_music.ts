import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import { z } from "zod";
import { ROOT, getCurrentDateString, invokeStructuredLlm } from "../io/core.js";

const ConfigSchema = z.object({
	yue: z.object({
		dir: z.string(),
		hf_home: z.string(),
		python: z.string(),
		script: z.string(),
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
});
const DraftSchema = z.object({
	title: z.string(),
	style_tail: z.string(),
	sections: z.array(z.array(z.string())),
});
const LedgerRowSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("generation"),
		id: z.string(),
		at: z.string(),
		cell: z.record(z.string(), z.string()),
		title: z.string(),
		seed: z.number(),
		audio: z.string(),
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
]);
type LedgerRow = z.infer<typeof LedgerRowSchema>;

const config = ConfigSchema.parse(
	yaml.load(
		fs.readFileSync(path.join(ROOT, "config/music/humanity.yaml"), "utf-8"),
	),
);
const outputDir = path.join(ROOT, config.output_dir);
const ledgerPath = path.join(outputDir, "ledger.jsonl");

function readLedger(): LedgerRow[] {
	return fs.existsSync(ledgerPath)
		? fs
				.readFileSync(ledgerPath, "utf-8")
				.split("\n")
				.filter(Boolean)
				.map((line) => LedgerRowSchema.parse(JSON.parse(line)))
		: [];
}

function append(row: LedgerRow): void {
	fs.ensureDirSync(outputDir);
	fs.appendFileSync(ledgerPath, `${JSON.stringify(row)}\n`);
}

function scoresOf(rows: LedgerRow[]): Map<string, number> {
	return new Map(
		rows.flatMap((row) => (row.kind === "rating" ? [[row.id, row.score]] : [])),
	);
}

function writePlaylist(): void {
	const rows = readLedger();
	const scores = scoresOf(rows);
	const songs = rows
		.flatMap((row) => (row.kind === "generation" ? [row] : []))
		.sort(
			(a, b) =>
				(scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) ||
				b.at.localeCompare(a.at),
		);
	const lines = songs.flatMap((song) => [
		`#EXTINF:${Math.round(song.seconds)},${song.title}`,
		path.relative(
			outputDir,
			path.join(path.dirname(song.audio), config.playlist.audio_file),
		),
	]);
	fs.writeFileSync(
		path.join(outputDir, config.playlist.file),
		`#EXTM3U\n${lines.join("\n")}\n`,
	);
}

function pick<T>(items: T[]): T {
	return items[Math.floor(Math.random() * items.length)] as T;
}

function rarestCell(rows: LedgerRow[]): Record<string, string> {
	const cells = rows.flatMap((row) =>
		row.kind === "generation" ? [row.cell] : [],
	);
	return Object.fromEntries(
		Object.entries(config.axes).map(([axis, values]) => {
			const counts = values.map(
				(value) => cells.filter((cell) => cell[axis] === value).length,
			);
			const min = Math.min(...counts);
			return [axis, pick(values.filter((_, i) => counts[i] === min))];
		}),
	);
}

async function generate(): Promise<void> {
	const cell = rarestCell(readLedger());
	const draft = await invokeStructuredLlm({
		schema: DraftSchema,
		name: "humanity_music_draft",
		llmOptions: { temperature: config.temperature },
		validate: (value) => {
			if (
				value.sections.length !== config.structure.length ||
				value.sections.some(
					(lines) => lines.length !== config.lines_per_section,
				)
			)
				throw new Error("sections do not match the configured structure");
			return value;
		},
		messages: () => [
			{
				role: "system",
				content: `あなたは人類観測所の作詞家です。${config.lyrics_rule} sectionsは${config.structure.join("、")}の順に${config.structure.length}個、各${config.lines_per_section}行。style_tailには曲調を英語で短く書く。`,
			},
			{ role: "user", content: JSON.stringify(cell) },
		],
	});
	const stamp = new Date().toISOString().replaceAll(/[-:.]/g, "").slice(0, 15);
	const id = `${getCurrentDateString()}-${stamp}`;
	const seed = Math.floor(Math.random() * 2 ** 31);
	const runDir = path.join(outputDir, id);
	fs.ensureDirSync(runDir);
	const requestPath = path.join(runDir, "request.json");
	const songDir = path.join(runDir, "song");
	fs.writeJsonSync(requestPath, {
		id,
		style: `${config.style_base}, ${draft.style_tail}`,
		lyrics: config.structure
			.map((tag, i) => `[${tag}]\n${draft.sections[i]?.join("\n")}`)
			.join("\n\n"),
		cot: "full",
		seed,
	});
	const yue = Bun.spawnSync(
		[
			path.join(config.yue.dir, config.yue.python),
			config.yue.script,
			"--request",
			requestPath,
			"--output",
			songDir,
		],
		{
			cwd: config.yue.dir,
			env: { ...process.env, HF_HOME: config.yue.hf_home },
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	if (yue.exitCode !== 0) throw new Error(`YuE2 failed: ${yue.exitCode}`);
	Bun.spawnSync([
		"ffmpeg",
		"-y",
		"-loglevel",
		"error",
		"-i",
		path.join(songDir, "audio.flac"),
		"-b:a",
		config.playlist.bitrate,
		path.join(songDir, config.playlist.audio_file),
	]);
	const result = fs.readJsonSync(path.join(songDir, "result.json"));
	append({
		kind: "generation",
		id,
		at: new Date().toISOString(),
		cell,
		title: draft.title,
		seed,
		audio: path.join(songDir, "audio.flac"),
		seconds: result.audio_seconds,
		truncated: Object.values(result.truncated as Record<string, boolean>).some(
			Boolean,
		),
	});
	writePlaylist();
	console.log(JSON.stringify({ id, cell, title: draft.title }));
}

function rate(id: string, score: number, note: string): void {
	if (!readLedger().some((row) => row.kind === "generation" && row.id === id))
		throw new Error(`unknown song id: ${id}`);
	if (score < config.rating.min || score > config.rating.max)
		throw new Error(`score must be ${config.rating.min}-${config.rating.max}`);
	append({ kind: "rating", id, at: new Date().toISOString(), score, note });
	writePlaylist();
}

function report(): void {
	const rows = readLedger();
	const scores = new Map(
		rows.flatMap((row) => (row.kind === "rating" ? [[row.id, row.score]] : [])),
	);
	const songs = rows.flatMap((row) => (row.kind === "generation" ? [row] : []));
	const byAxis = Object.fromEntries(
		Object.keys(config.axes).map((axis) => {
			const groups = new Map<string, number[]>();
			for (const song of songs) {
				const score = scores.get(song.id);
				const value = song.cell[axis];
				if (score !== undefined && value)
					groups.set(value, [...(groups.get(value) ?? []), score]);
			}
			return [
				axis,
				Object.fromEntries(
					[...groups].map(([value, list]) => [
						value,
						{
							n: list.length,
							mean: list.reduce((a, b) => a + b, 0) / list.length,
						},
					]),
				),
			];
		}),
	);
	console.log(
		JSON.stringify(
			{ songs: songs.length, rated: scores.size, by_axis: byAxis },
			null,
			2,
		),
	);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "generate") await generate();
else if (command === "rate")
	rate(rest[0] ?? "", Number(rest[1]), rest[2] ?? "");
else if (command === "report") report();
else if (command === "playlist") writePlaylist();
else
	throw new Error(
		"usage: generate | rate <id> <score> [note] | report | playlist",
	);
