import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { auditEpisode } from "../domain/episode/compiler.js";
import { buildRemotionWorkspaceFiles } from "../domain/episode/remotion_workspace.js";
import { EpisodeSchema } from "../domain/episode/schema.js";
import {
	auditExperienceEpisode,
	buildRendererMetrics,
} from "../domain/experience/audit.js";
import { loadByosanExperienceConfig } from "../domain/experience/config.js";
import { compileEpisode } from "./compile_episode.js";
import { renderEpisode } from "./render_episode.js";

function requiredArg(argv: string[], name: string): string {
	for (let index = 0; index < argv.length; index++) {
		if (argv[index] === `--${name}`) return argv[index + 1] ?? "";
	}
	throw new Error(`--${name} is required`);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
	await Bun.write(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function benchmarkExperienceBaseline(
	episodePath: string,
	outPath: string,
): Promise<void> {
	const episodeFile = path.resolve(episodePath);
	const outDir = path.resolve(outPath);
	const parsed = EpisodeSchema.parse(
		JSON.parse(await readFile(episodeFile, "utf8")),
	);
	const { profile, world } = await loadByosanExperienceConfig();
	const issues = [
		...auditEpisode(parsed),
		...auditExperienceEpisode(parsed, profile),
	];
	if (issues.length > 0)
		throw new Error(`baseline episode failed audit: ${JSON.stringify(issues)}`);

	const productionStart = new Date();
	const productionClock = performance.now();
	const compiled = path.join(outDir, "compiled");
	const output = path.join(outDir, "baseline", "render.mp4");
	await compileEpisode({
		episode: episodeFile,
		out: compiled,
		ffprobe: process.env.FFPROBE_BIN?.trim() || "ffprobe",
	});
	const renderStart = performance.now();
	await renderEpisode({
		compiled,
		kind: "main",
		output,
		dryRun: false,
	});
	const renderSeconds = (performance.now() - renderStart) / 1000;
	const finish = new Date();
	const outputBuffer = await readFile(output);
	const remotionFiles = buildRemotionWorkspaceFiles(world);
	const generatedSourceLines = Object.entries(remotionFiles)
		.filter(([name]) => name.endsWith(".ts") || name.endsWith(".tsx"))
		.reduce(
			(count, [, contents]) => count + contents.split("\n").length - 1,
			0,
		);
	const lockPath = path.join(compiled, "remotion", "bun.lock");
	const dependencyLockBytes = (await Bun.file(lockPath).exists())
		? Bun.file(lockPath).size
		: null;
	const metrics = buildRendererMetrics({
		engine: "remotion-existing",
		scene_id: "episode",
		started_at: productionStart.toISOString(),
		finished_at: finish.toISOString(),
		render_seconds: renderSeconds,
		output_bytes: outputBuffer.byteLength,
		output_sha256: createHash("sha256").update(outputBuffer).digest("hex"),
		reused_asset_count: parsed.visuals.filter(
			(visual) => visual.asset_strategy === "reuse",
		).length,
		custom_code_lines: generatedSourceLines,
		dependency_lock_bytes: dependencyLockBytes,
	});
	await writeJson(path.join(outDir, "baseline", "metrics.json"), metrics);
	await writeJson(path.join(outDir, "baseline", "command.json"), {
		compile: [
			"task",
			"episode:compile",
			`EPISODE=${episodeFile}`,
			`OUT=${compiled}`,
		],
		render: [
			"task",
			"episode:render",
			`COMPILED=${compiled}`,
			`OUTPUT=${output}`,
			"KIND=main",
		],
	});
	await writeJson(path.join(outDir, "baseline", "environment.json"), {
		bun_version: Bun.version,
		node_version: process.version,
		remotion_version:
			JSON.parse(remotionFiles["package.json"] ?? "{}").dependencies
				?.remotion ?? null,
		profile: profile.channel,
		production_wall_seconds: (performance.now() - productionClock) / 1000,
	});
	console.log(
		JSON.stringify(
			{ status: "PASS", engine: "remotion-existing", output, metrics },
			null,
			2,
		),
	);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
	try {
		await benchmarkExperienceBaseline(
			requiredArg(argv, "episode"),
			requiredArg(argv, "out"),
		);
		return 0;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

if (import.meta.main) process.exit(await main());
