import { createHash } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import { MOTION_CANVAS_VERSION } from "../domain/episode/motion_canvas_workspace.js";
import {
	REMOTION_VERSION,
	buildRemotionRenderCommand,
	buildRemotionWorkspaceFiles,
} from "../domain/episode/remotion_workspace.js";
import {
	buildExperienceBenchmarkSummary,
	buildRendererMetrics,
} from "../domain/experience/audit.js";
import { loadByosanExperienceConfig } from "../domain/experience/config.js";
import { buildExperienceLicenseEvidence } from "../domain/experience/license_evidence.js";
import type {
	ExperienceRenderInput,
	ExperienceRenderItem,
} from "../domain/experience/schema.js";
import { installBunWorkspace } from "./experience_workspace.js";
import {
	renderMotionCanvasInput,
	resolveMotionCanvasChromiumPath,
} from "./render_episode_motion_canvas.js";

function parseOut(argv: string[]): string {
	for (let index = 0; index < argv.length; index++) {
		if (argv[index] === "--out") return argv[index + 1] ?? "";
	}
	return "artifacts/benchmarks/experience-os";
}

async function run(command: string[], cwd: string): Promise<void> {
	const child = Bun.spawn(command, {
		cwd,
		stdin: "ignore",
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await child.exited;
	if (exitCode !== 0)
		throw new Error(`command failed (${exitCode}): ${command.join(" ")}`);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
	await fs.ensureDir(path.dirname(filePath));
	await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sceneInput(
	benchmark: ExperienceRenderInput,
	item: ExperienceRenderItem,
): ExperienceRenderInput {
	const duration = item.endFrame - item.startFrame;
	return {
		fps: benchmark.fps,
		width: benchmark.width,
		height: benchmark.height,
		durationInFrames: duration,
		items: [{ ...item, startFrame: 0, endFrame: duration }],
	};
}

async function sha256File(filePath: string): Promise<string> {
	const value = await fs.readFile(filePath);
	return createHash("sha256").update(value).digest("hex");
}

function runId(): string {
	return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export async function benchmarkExperience(outPath: string): Promise<void> {
	const config = await loadByosanExperienceConfig();
	const startedAt = new Date();
	const runDirectory = path.join(path.resolve(outPath), runId());
	await fs.ensureDir(runDirectory);
	const comparisons: Array<{
		scene_id: string;
		baseline: ReturnType<typeof buildRendererMetrics>;
		motion_canvas: ReturnType<typeof buildRendererMetrics>;
	}> = [];
	const remotionFiles = buildRemotionWorkspaceFiles(config.world);
	const baselineWorkspace = path.join(runDirectory, "baseline", "remotion");
	await fs.ensureDir(baselineWorkspace);
	for (const [relativePath, contents] of Object.entries(remotionFiles)) {
		await fs.writeFile(
			path.join(baselineWorkspace, relativePath),
			contents,
			"utf8",
		);
	}
	const baselineSetupClock = performance.now();
	await installBunWorkspace(baselineWorkspace);
	const baselineSetupSeconds = (performance.now() - baselineSetupClock) / 1000;
	const motionCanvasWorkspace = path.join(
		runDirectory,
		"motion-canvas",
		"workspace",
	);
	let motionCanvasDependenciesReady = false;
	let motionCanvasSetupSeconds: number | null = null;

	for (const canonicalItem of config.benchmark.items) {
		console.log(`[experience:benchmark] scene ${canonicalItem.id}: Remotion`);
		const input = sceneInput(config.benchmark, canonicalItem);
		const sceneDirectory = path.join(runDirectory, "scenes", canonicalItem.id);
		const inputPath = path.join(sceneDirectory, "render-input.json");
		await writeJson(inputPath, input);

		const baselineDirectory = path.join(sceneDirectory, "baseline");
		const baselineOutput = path.join(baselineDirectory, "render.mp4");
		await fs.ensureDir(baselineDirectory);
		const baselineStart = new Date();
		const baselineRenderClock = performance.now();
		const baselineCommand = buildRemotionRenderCommand(
			inputPath,
			baselineOutput,
		);
		await run(baselineCommand, baselineWorkspace);
		const baselineRenderSeconds =
			(performance.now() - baselineRenderClock) / 1000;
		const baselineFinish = new Date();
		const baselineOutputBytes = (await fs.stat(baselineOutput)).size;
		if (baselineOutputBytes <= 0)
			throw new Error(`Remotion produced an empty output: ${baselineOutput}`);
		const baselineLockPath = path.join(baselineWorkspace, "bun.lock");
		const baselineMetrics = buildRendererMetrics({
			engine: "remotion-existing",
			scene_id: canonicalItem.id,
			started_at: baselineStart.toISOString(),
			finished_at: baselineFinish.toISOString(),
			render_seconds: baselineRenderSeconds,
			output_bytes: baselineOutputBytes,
			output_sha256: await sha256File(baselineOutput),
			new_asset_count: 0,
			reused_asset_count: 0,
			custom_code_lines: Object.entries(remotionFiles)
				.filter(([name]) => name.endsWith(".ts") || name.endsWith(".tsx"))
				.reduce(
					(sum, [, contents]) => sum + contents.split("\n").length - 1,
					0,
				),
			dependency_lock_bytes: (await fs.pathExists(baselineLockPath))
				? (await fs.stat(baselineLockPath)).size
				: null,
		});
		baselineMetrics.production_seconds = baselineRenderSeconds;
		await writeJson(
			path.join(baselineDirectory, "metrics.json"),
			baselineMetrics,
		);
		await writeJson(path.join(baselineDirectory, "command.json"), {
			argv: baselineCommand,
			cwd: baselineWorkspace,
		});
		await writeJson(path.join(baselineDirectory, "environment.json"), {
			bun_version: Bun.version,
			node_compat_version: process.versions.node,
			engine_version: REMOTION_VERSION,
			encoding: {
				codec: "h264",
				crf: 18,
				pixel_format: "yuvj420p",
				color_range: "full",
			},
			image_width: input.width,
			image_height: input.height,
			fps: input.fps,
		});

		const motionCanvasDirectory = path.join(sceneDirectory, "motion-canvas");
		const motionCanvasOutput = path.join(motionCanvasDirectory, "render.mp4");
		const firstMotionCanvasScene = !motionCanvasDependenciesReady;
		const motionCanvasStart = new Date();
		const motionCanvasClock = performance.now();
		console.log(
			`[experience:benchmark] scene ${canonicalItem.id}: Motion Canvas`,
		);
		const motionCanvasResult = await renderMotionCanvasInput(
			input,
			motionCanvasOutput,
			motionCanvasWorkspace,
			{ dependenciesReady: motionCanvasDependenciesReady },
		);
		if (!motionCanvasResult)
			throw new Error(
				`Motion Canvas emitted no result for ${canonicalItem.id}`,
			);
		if (!motionCanvasDependenciesReady) {
			motionCanvasSetupSeconds = Math.max(
				0,
				motionCanvasResult.production_seconds -
					motionCanvasResult.render_seconds,
			);
			motionCanvasDependenciesReady = true;
		}
		const motionCanvasFinish = new Date();
		const motionCanvasMetrics = buildRendererMetrics({
			engine: "motion-canvas",
			scene_id: canonicalItem.id,
			started_at: motionCanvasStart.toISOString(),
			finished_at: motionCanvasFinish.toISOString(),
			render_seconds: motionCanvasResult.render_seconds,
			output_bytes: motionCanvasResult.output_bytes,
			output_sha256: motionCanvasResult.output_sha256,
			new_asset_count: 0,
			reused_asset_count: 0,
			custom_code_lines: motionCanvasResult.custom_code_lines,
			dependency_lock_bytes: motionCanvasResult.dependency_lock_bytes,
		});
		const excludedSetupSeconds = firstMotionCanvasScene
			? (motionCanvasSetupSeconds ?? 0)
			: 0;
		motionCanvasMetrics.production_seconds = Math.max(
			0,
			(performance.now() - motionCanvasClock) / 1000 - excludedSetupSeconds,
		);
		await writeJson(
			path.join(motionCanvasDirectory, "metrics.json"),
			motionCanvasMetrics,
		);
		await writeJson(path.join(motionCanvasDirectory, "command.json"), {
			argv: [
				"task",
				"episode:render:motion-canvas",
				inputPath,
				motionCanvasOutput,
			],
			workspace: motionCanvasWorkspace,
		});
		await writeJson(path.join(motionCanvasDirectory, "environment.json"), {
			bun_version: Bun.version,
			node_compat_version: process.versions.node,
			engine_version: MOTION_CANVAS_VERSION,
			encoding: {
				codec: "h264",
				crf: 18,
				pixel_format: "yuvj420p",
				color_range: "full",
			},
			image_width: input.width,
			image_height: input.height,
			fps: input.fps,
			chromium_path: resolveMotionCanvasChromiumPath() ?? null,
		});

		comparisons.push({
			scene_id: canonicalItem.id,
			baseline: baselineMetrics,
			motion_canvas: motionCanvasMetrics,
		});
	}

	const manifest = {
		schema_version: 1,
		status: "COMPLETE",
		decision: "BENCHMARK_ONLY",
		run_id: path.basename(runDirectory),
		started_at: startedAt.toISOString(),
		finished_at: new Date().toISOString(),
		channel: config.profile.channel,
		input_path: "config/channels/byosan/benchmark-scenes.json",
		input_sha256: createHash("sha256")
			.update(JSON.stringify(config.benchmark))
			.digest("hex"),
		scene_ids: config.benchmark.items.map((item) => item.id),
		engines: {
			baseline: {
				id: "remotion-existing",
				version: REMOTION_VERSION,
				setup_seconds: baselineSetupSeconds,
			},
			candidate: {
				id: "motion-canvas",
				version: MOTION_CANVAS_VERSION,
				setup_seconds: motionCanvasSetupSeconds,
			},
		},
		license_status: "PARTIALLY_VERIFIED",
		license_evidence: buildExperienceLicenseEvidence({
			remotionVersion: REMOTION_VERSION,
			motionCanvasVersion: MOTION_CANVAS_VERSION,
		}),
		human_quality_review: "NOT_RUN",
	};
	await writeJson(path.join(runDirectory, "manifest.json"), manifest);
	await writeJson(
		path.join(runDirectory, "summary.json"),
		buildExperienceBenchmarkSummary(comparisons),
	);
	console.log(
		JSON.stringify(
			{ status: "PASS", run_directory: runDirectory, manifest },
			null,
			2,
		),
	);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
	try {
		const unknown = argv.filter(
			(argument, index) =>
				argument.startsWith("--") &&
				argument !== "--out" &&
				argv[index - 1] !== "--out",
		);
		if (unknown.length > 0)
			throw new Error(`unknown argument: ${unknown.join(", ")}`);
		await benchmarkExperience(parseOut(argv));
		return 0;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

if (import.meta.main) process.exit(await main());
