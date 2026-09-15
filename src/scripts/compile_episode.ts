import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import fs from "fs-extra";
import { measureEpisodeAudio } from "../domain/episode/audio.js";
import {
	applyLocalePatch,
	auditEpisode,
	auditLocalePatch,
	buildChapters,
	buildEpisodeManifest,
	buildScriptMaster,
	buildShortPlan,
	buildSubtitles,
	buildTimeline,
	buildYouTubeMetadata,
	extractTranslatableStrings,
} from "../domain/episode/compiler.js";
import {
	buildRemotionInput,
	buildRemotionWorkspaceFiles,
} from "../domain/episode/remotion_workspace.js";
import { parseEpisode, parseLocalePatch } from "../domain/episode/schema.js";

interface Args {
	episode: string;
	out: string;
	localePatch?: string;
	ffprobe: string;
}

function parseArgs(argv: string[]): Args {
	let episode = "";
	let out = "";
	let localePatch: string | undefined;
	let ffprobe = "ffprobe";
	for (let index = 0; index < argv.length; index++) {
		const value = argv[index];
		if (value === "--episode") episode = argv[++index] ?? "";
		else if (value === "--out") out = argv[++index] ?? "";
		else if (value === "--locale-patch") localePatch = argv[++index] ?? "";
		else if (value === "--ffprobe") ffprobe = argv[++index] ?? "ffprobe";
		else throw new Error(`unknown argument: ${value}`);
	}
	if (!episode) throw new Error("--episode is required");
	if (!out) throw new Error("--out is required");
	return { episode, out, localePatch, ffprobe };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function compileEpisode(args: Args): Promise<void> {
	const episodePath = path.resolve(args.episode);
	const episodeDir = path.dirname(episodePath);
	const outDir = path.resolve(args.out);
	let episode = parseEpisode(await readFile(episodePath, "utf8"));

	const baseIssues = auditEpisode(episode);
	if (baseIssues.length > 0) throw new Error(JSON.stringify(baseIssues, null, 2));
	if (args.localePatch) {
		const patch = parseLocalePatch(
			await readFile(path.resolve(args.localePatch), "utf8"),
		);
		const localeIssues = auditLocalePatch(episode, patch);
		if (localeIssues.length > 0)
			throw new Error(JSON.stringify(localeIssues, null, 2));
		episode = applyLocalePatch(episode, patch);
	}

	for (const asset of episode.assets) {
		const assetPath = path.resolve(episodeDir, asset.path);
		if (!fs.existsSync(assetPath))
			throw new Error(`missing asset file: ${asset.path}`);
	}

	const durations = measureEpisodeAudio(
		episode,
		(audioPath) => path.resolve(episodeDir, audioPath),
		args.ffprobe,
	);
	const timeline = buildTimeline(episode, durations);
	const shortPlan = episode.shorts.enabled
		? buildShortPlan(episode, timeline)
		: null;
	const manifest = buildEpisodeManifest(episode, timeline, shortPlan);
	const remotionDir = path.join(outDir, "remotion");
	await mkdir(remotionDir, { recursive: true });

	await writeFile(
		path.join(outDir, "script_master.md"),
		buildScriptMaster(episode),
		"utf8",
	);
	await writeFile(
		path.join(outDir, "youtube_metadata.md"),
		buildYouTubeMetadata(episode),
		"utf8",
	);
	await writeFile(
		path.join(outDir, "chapters.txt"),
		buildChapters(episode, timeline),
		"utf8",
	);
	await writeFile(
		path.join(outDir, "subtitles.srt"),
		buildSubtitles(episode, timeline),
		"utf8",
	);
	await writeJson(path.join(outDir, "episode.resolved.json"), episode);
	await writeJson(path.join(outDir, "timeline.json"), timeline);
	await writeJson(path.join(outDir, "thumbnail.json"), episode.thumbnail);
	await writeJson(
		path.join(outDir, "translations.json"),
		extractTranslatableStrings(episode),
	);
	await writeJson(path.join(outDir, "short.json"), shortPlan);
	await writeJson(path.join(outDir, "episode.manifest.json"), manifest);
	await writeJson(
		path.join(outDir, "render-input-main.json"),
		buildRemotionInput(episode, timeline),
	);
	if (shortPlan) {
		await writeJson(
			path.join(outDir, "render-input-short.json"),
			buildRemotionInput(episode, timeline, shortPlan),
		);
	}
	for (const [name, content] of Object.entries(buildRemotionWorkspaceFiles())) {
		await writeFile(path.join(remotionDir, name), content, "utf8");
	}
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
	try {
		await compileEpisode(parseArgs(argv));
		console.log(JSON.stringify({ status: "DONE" }));
		return 0;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

if (import.meta.main) process.exit(await main());
