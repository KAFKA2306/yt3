import { writeFile } from "node:fs/promises";
import path from "node:path";
import fs from "fs-extra";
import { extractTranslatableStrings } from "../domain/episode/compiler.js";
import { parseEpisode } from "../domain/episode/schema.js";
import { compileEpisode } from "./compile_episode.js";
import { renderEpisode } from "./render_episode.js";

async function run(command: string[]): Promise<void> {
	const child = Bun.spawn(command, {
		stdin: "ignore",
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await child.exited;
	if (exitCode !== 0)
		throw new Error(`command failed (${exitCode}): ${command.join(" ")}`);
}

export async function smokeEpisodePipeline(
	root = path.resolve(".artifacts/episode-render-smoke"),
): Promise<void> {
	await fs.remove(root);
	await fs.ensureDir(root);
	const wavPath = path.join(root, "line.wav");
	await run([
		"ffmpeg",
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:duration=0.8",
		"-c:a",
		"pcm_s16le",
		wavPath,
	]);

	const episodeObject = {
		schema_version: 1,
		metadata: {
			title: "Episode smoke",
			description: "Canonical episode render smoke",
			tags: ["smoke"],
			language: "ja",
		},
		fps: 10,
		sources: [{ id: "source1", url: "https://example.com", title: "Source" }],
		claims: [{ id: "claim1", text: "Smoke claim", source_ids: ["source1"] }],
		assets: [],
		visuals: [
			{
				id: "visual1",
				type: "title",
				props: { title: "JSON to video", subtitle: "Remotion + FFmpeg" },
				elements: [],
				source_ref: "source1",
			},
		],
		sections: [
			{
				id: "intro",
				title: "Intro",
				dialogue: [
					{
						id: "line1",
						speaker: "KAFKA",
						text: "レンダリング確認",
						subtitle: "レンダリング確認",
						visual_ref: "visual1",
						audio: { path: "line.wav" },
					},
				],
			},
		],
		thumbnail: { lines: ["Episode smoke"], layout: {} },
		shorts: { enabled: true, max_seconds: 60 },
		locales: ["en"],
	} as const;
	const episode = parseEpisode(JSON.stringify(episodeObject));
	const episodePath = path.join(root, "episode.json");
	await writeFile(
		episodePath,
		`${JSON.stringify(episodeObject, null, 2)}\n`,
		"utf8",
	);

	const jaDir = path.join(root, "ja");
	await compileEpisode({
		episode: episodePath,
		out: jaDir,
		ffprobe: "ffprobe",
	});
	await renderEpisode({
		compiled: jaDir,
		kind: "main",
		output: path.join(root, "ja-main.mp4"),
		dryRun: false,
	});
	await renderEpisode({
		compiled: jaDir,
		kind: "short",
		output: path.join(root, "ja-short.mp4"),
		dryRun: false,
	});

	const strings = extractTranslatableStrings(episode);
	const localePath = path.join(root, "en.json");
	await writeFile(
		localePath,
		`${JSON.stringify(
			{
				locale: "en",
				strings: Object.fromEntries(
					Object.entries(strings).map(([key, value]) => [key, `EN ${value}`]),
				),
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	const enDir = path.join(root, "en");
	await compileEpisode({
		episode: episodePath,
		out: enDir,
		localePatch: localePath,
		ffprobe: "ffprobe",
	});
	await renderEpisode({
		compiled: enDir,
		kind: "main",
		output: path.join(root, "en-main.mp4"),
		dryRun: false,
	});

	for (const name of ["ja-main.mp4", "ja-short.mp4", "en-main.mp4"]) {
		const output = path.join(root, name);
		if (!fs.existsSync(output) || fs.statSync(output).size === 0)
			throw new Error(`smoke output missing: ${name}`);
	}
	console.log(
		JSON.stringify({
			status: "PASS",
			outputs: ["ja-main.mp4", "ja-short.mp4", "en-main.mp4"],
		}),
	);
}

if (import.meta.main) {
	try {
		await smokeEpisodePipeline();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
