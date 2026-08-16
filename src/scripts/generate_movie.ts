import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const SceneSchema = z.object({
	id: z.string().regex(/^[A-Za-z0-9_-]+$/),
	prompt: z.string().min(1),
	seed: z.number().int().nonnegative().optional(),
	fps: z.number().int().positive().optional(),
	height: z.number().int().positive().optional(),
	width: z.number().int().positive().optional(),
	num_frames: z.number().int().positive().optional(),
	num_inference_steps: z.number().int().positive().optional(),
	guidance_scale: z.number().finite().optional(),
});

const MoviePlanSchema = z.object({
	output: z.string().min(1),
	model: z.string().min(1).optional(),
	scenes: z.array(SceneSchema).min(1),
});

export type MoviePlan = z.infer<typeof MoviePlanSchema>;
export type MovieScene = z.infer<typeof SceneSchema>;

export interface RuntimeConfig {
	hfCacheHubRoot: string;
	python: string;
	ffmpeg: string;
}

export function parseMoviePlan(text: string): MoviePlan {
	return MoviePlanSchema.parse(JSON.parse(text));
}

export function buildGeneratorCommand(
	plan: MoviePlan,
	scene: MovieScene,
	output: string,
	config: RuntimeConfig,
): string[] {
	const args = [
		config.python,
		path.join(config.hfCacheHubRoot, "scripts", "generate_video.py"),
		"--prompt",
		scene.prompt,
		"--output",
		output,
		"--registry",
		path.join(config.hfCacheHubRoot, "models.yaml"),
		"--project-root",
		config.hfCacheHubRoot,
	];
	if (plan.model) args.push("--model", plan.model);
	for (const [flag, value] of [
		["--seed", scene.seed],
		["--fps", scene.fps],
		["--height", scene.height],
		["--width", scene.width],
		["--num-frames", scene.num_frames],
		["--num-inference-steps", scene.num_inference_steps],
		["--guidance-scale", scene.guidance_scale],
	] as const) {
		if (value !== undefined) args.push(flag, String(value));
	}
	return args;
}

function quoteConcatPath(value: string): string {
	return value.replaceAll("'", "'\\''");
}

export function buildConcatFile(scenePaths: string[]): string {
	return `${scenePaths.map((scene) => `file '${quoteConcatPath(path.resolve(scene))}'`).join("\n")}\n`;
}

export function buildFfmpegCommand(concatFile: string, output: string, ffmpeg: string): string[] {
	return [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", output];
}

async function run(command: string[]): Promise<void> {
	const process = Bun.spawn(command, { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
	const exitCode = await process.exited;
	if (exitCode !== 0) throw new Error(`command failed (${exitCode}): ${command[0]}`);
}

function parseArgs(argv: string[]): { planFile: string; dryRun: boolean } {
	let planFile = "";
	let dryRun = false;
	for (let index = 0; index < argv.length; index++) {
		const value = argv[index];
		if (value === "--dry-run") dryRun = true;
		else if (value === "--plan") planFile = argv[++index] ?? "";
		else throw new Error(`unknown argument: ${value}`);
	}
	if (!planFile) throw new Error("--plan is required");
	return { planFile, dryRun };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
	try {
		const args = parseArgs(argv);
		const planFile = path.resolve(args.planFile);
		const planText = await readFile(planFile, "utf8");
		const plan = parseMoviePlan(planText);
		const output = path.resolve(path.dirname(planFile), plan.output);
		const stem = path.basename(output, path.extname(output));
		const sceneDir = path.join(path.dirname(output), `${stem}.scenes`);
		const config: RuntimeConfig = {
			hfCacheHubRoot: path.resolve(process.env.HF_CACHE_HUB_ROOT ?? "../hf-cache-hub"),
			python: process.env.VIDEO_PYTHON ?? "python3",
			ffmpeg: process.env.FFMPEG_BIN ?? "ffmpeg",
		};
		const scenePaths = plan.scenes.map((scene, index) =>
			path.join(sceneDir, `${String(index + 1).padStart(3, "0")}-${scene.id}.mp4`),
		);
		const generatorCommands = plan.scenes.map((scene, index) =>
			buildGeneratorCommand(plan, scene, scenePaths[index] as string, config),
		);
		const concatFile = path.join(sceneDir, "concat.txt");
		const ffmpegCommand = buildFfmpegCommand(concatFile, output, config.ffmpeg);

		if (args.dryRun) {
			console.log(JSON.stringify({ status: "READY", plan: planFile, output, generatorCommands, ffmpegCommand }, null, 2));
			return 0;
		}

		await mkdir(sceneDir, { recursive: true });
		for (const command of generatorCommands) await run(command);
		await writeFile(concatFile, buildConcatFile(scenePaths), "utf8");
		await run(ffmpegCommand);

		const manifest = {
			schema_version: 1,
			plan: planFile,
			plan_sha256: createHash("sha256").update(planText).digest("hex"),
			output,
			model: plan.model ?? null,
			scenes: plan.scenes.map((scene, index) => ({ id: scene.id, output: scenePaths[index], prompt: scene.prompt })),
		};
		await writeFile(`${output}.json`, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
		console.log(JSON.stringify({ status: "DONE", output, manifest: `${output}.json` }, null, 2));
		return 0;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

if (import.meta.main) process.exit(await main());
