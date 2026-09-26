import { createHash } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "fs-extra";
import {
	buildEpisodeMuxCommand,
	finalizeEpisodeVideo,
	removeIfExists,
} from "../domain/episode/finalizer.js";
import { buildMotionCanvasWorkspaceFiles } from "../domain/episode/motion_canvas_workspace.js";
import { loadByosanExperienceConfig } from "../domain/experience/config.js";
import { ExperienceRenderInputSchema } from "../domain/experience/schema.js";
import { installBunWorkspace } from "./experience_workspace.js";

export interface RenderMotionCanvasArgs {
	compiled: string;
	kind: "main" | "short";
	output: string;
	dryRun: boolean;
}

export interface MotionCanvasRenderResult {
	production_seconds: number;
	render_seconds: number;
	output_bytes: number;
	output_sha256: string;
	custom_code_lines: number;
	dependency_lock_bytes: number | null;
}

function parseArgs(argv: string[]): RenderMotionCanvasArgs {
	let compiled = "";
	let kind: "main" | "short" = "main";
	let output = "";
	let dryRun = false;
	for (let index = 0; index < argv.length; index++) {
		const value = argv[index];
		if (value === "--compiled") compiled = argv[++index] ?? "";
		else if (value === "--kind") {
			const next = argv[++index];
			if (next !== "main" && next !== "short")
				throw new Error("--kind must be main or short");
			kind = next;
		} else if (value === "--output") output = argv[++index] ?? "";
		else if (value === "--dry-run") dryRun = true;
		else throw new Error(`unknown argument: ${value}`);
	}
	if (!compiled) throw new Error("--compiled is required");
	if (!output) throw new Error("--output is required");
	return { compiled, kind, output, dryRun };
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

async function allocatePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("could not allocate a local Motion Canvas port");
	const port = address.port;
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	return port;
}

async function waitForServer(url: string, child: ReturnType<typeof Bun.spawn>) {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null)
			throw new Error(`Motion Canvas dev server exited (${child.exitCode})`);
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// Vite is still starting; retry until the bounded startup deadline.
		}
		await Bun.sleep(500);
	}
	throw new Error(`Motion Canvas dev server did not become ready: ${url}`);
}

async function listPngFiles(directory: string): Promise<string[]> {
	if (!(await fs.pathExists(directory))) return [];
	const entries = await fs.readdir(directory, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const fullPath = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await listPngFiles(fullPath)));
		else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
			files.push(fullPath);
	}
	return files;
}

function numericFrameNumber(filePath: string): number {
	const match = path.basename(filePath).match(/(\d+)(?=\.png$)/i);
	if (!match)
		throw new Error(`unexpected Motion Canvas frame name: ${filePath}`);
	return Number(match[1]);
}

function ffmpegConcatQuote(filePath: string): string {
	return `'${filePath.replaceAll("'", "'\\''")}'`;
}

export function resolveMotionCanvasChromiumPath(): string | undefined {
	return (
		process.env.MOTION_CANVAS_CHROMIUM?.trim() ||
		Bun.which("google-chrome") ||
		Bun.which("chromium") ||
		Bun.which("chromium-browser") ||
		undefined
	);
}

async function closeWithTimeout(
	close: () => Promise<void>,
	description: string,
): Promise<void> {
	await Promise.race([
		close(),
		Bun.sleep(5_000).then(() =>
			console.warn(`[motion-canvas] timed out while closing ${description}`),
		),
	]);
}

async function renderFramesThroughEditor(
	workspace: string,
	frameCount: number,
): Promise<number> {
	const executablePath = resolveMotionCanvasChromiumPath();
	if (!executablePath) {
		throw new Error(
			"Motion Canvas video export requires Chromium; set MOTION_CANVAS_CHROMIUM to its executable path",
		);
	}

	const playwrightEntry = path.join(
		workspace,
		"node_modules",
		"playwright-core",
		"index.mjs",
	);
	const playwright = (await import(pathToFileURL(playwrightEntry).href)) as {
		chromium: {
			launch(options: Record<string, unknown>): Promise<{
				newPage(): Promise<{
					goto(
						url: string,
						options?: Record<string, unknown>,
					): Promise<unknown>;
					locator(selector: string): {
						count(): Promise<number>;
						nth(index: number): {
							click(options?: Record<string, unknown>): Promise<void>;
						};
						evaluateAll<T>(
							fn: (
								elements: Array<{
									textContent: string | null;
									getAttribute(name: string): string | null;
								}>,
							) => T,
						): Promise<T>;
					};
					waitForTimeout(milliseconds: number): Promise<void>;
					close(): Promise<void>;
				}>;
				isConnected(): boolean;
				close(): Promise<void>;
			}>;
		};
	};
	const serverPort = await allocatePort();
	const url = `http://127.0.0.1:${serverPort}/`;
	console.log(`[motion-canvas] starting dev server at ${url}`);
	const server = Bun.spawn(
		[
			"bun",
			"node_modules/vite/bin/vite.js",
			"--host",
			"127.0.0.1",
			"--port",
			String(serverPort),
			"--strictPort",
		],
		{
			cwd: workspace,
			stdin: "ignore",
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	let browser:
		| Awaited<ReturnType<(typeof playwright.chromium)["launch"]>>
		| undefined;
	try {
		console.log(`[motion-canvas] launching browser: ${executablePath}`);
		browser = await playwright.chromium.launch({
			headless: true,
			executablePath,
			timeout: 30_000,
			args: ["--no-sandbox", "--disable-dev-shm-usage"],
		});
		console.log("[motion-canvas] browser launched; opening editor");
		const page = await browser.newPage();
		try {
			await waitForServer(url, server);
			await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
			console.log("[motion-canvas] editor loaded; locating render control");
			await page.waitForTimeout(2_000);

			const selector = "button, [role='button']";
			let count = await page.locator(selector).count();
			let labels = await page
				.locator(selector)
				.evaluateAll((elements) =>
					elements.map((element) =>
						[
							element.textContent ?? "",
							element.getAttribute("aria-label") ?? "",
							element.getAttribute("title") ?? "",
						]
							.join(" ")
							.trim(),
					),
				);
			let renderIndex = labels.findIndex((label) => /\brender\b/i.test(label));
			if (renderIndex < 0) {
				const settingsIndex = labels.findIndex((label) =>
					/(video|render).*(settings|options)|(settings|options).*(video|render)/i.test(
						label,
					),
				);
				if (settingsIndex >= 0) {
					await page.locator(selector).nth(settingsIndex).click();
					await page.waitForTimeout(500);
					count = await page.locator(selector).count();
					labels = await page
						.locator(selector)
						.evaluateAll((elements) =>
							elements.map((element) =>
								[
									element.textContent ?? "",
									element.getAttribute("aria-label") ?? "",
									element.getAttribute("title") ?? "",
								]
									.join(" ")
									.trim(),
							),
						);
					renderIndex = labels.findIndex((label) => /\brender\b/i.test(label));
				}
			}
			if (renderIndex < 0) {
				throw new Error(
					`could not locate Motion Canvas render control; observed ${count} controls: ${JSON.stringify(labels)}`,
				);
			}

			const startedAt = performance.now();
			await page.locator(selector).nth(renderIndex).click();
			console.log(`[motion-canvas] export started (${frameCount} frames)`);
			const renderDir = path.join(workspace, "render-frames");
			const deadline = Date.now() + 3 * 60_000;
			let observedFrames = 0;
			let lastProgressAt = Date.now();
			while (Date.now() < deadline) {
				if (!browser.isConnected())
					throw new Error("Motion Canvas browser disconnected during export");
				const frames = await listPngFiles(renderDir);
				observedFrames = frames.length;
				if (Date.now() - lastProgressAt >= 15_000) {
					console.log(
						`[motion-canvas] export progress: ${observedFrames}/${frameCount} frames`,
					);
					lastProgressAt = Date.now();
				}
				if (observedFrames >= frameCount) {
					console.log(
						`[motion-canvas] export complete (${observedFrames}/${frameCount} frames)`,
					);
					return (performance.now() - startedAt) / 1000;
				}
				await Bun.sleep(1_000);
			}
			throw new Error(
				`Motion Canvas render timed out at ${observedFrames}/${frameCount} frames`,
			);
		} finally {
			if (browser.isConnected())
				await closeWithTimeout(() => page.close(), "editor page");
			else
				console.warn(
					"[motion-canvas] browser disconnected; skipping page close",
				);
		}
	} finally {
		if (browser?.isConnected())
			await closeWithTimeout(
				() => browser?.close() ?? Promise.resolve(),
				"browser",
			);
		server.kill();
		await server.exited;
	}
}

async function encodeVideoFromFrames(
	workspace: string,
	output: string,
	fps: number,
	frameCount: number,
): Promise<void> {
	const frames = (
		await listPngFiles(path.join(workspace, "render-frames"))
	).sort((left, right) => numericFrameNumber(left) - numericFrameNumber(right));
	if (frames.length < frameCount)
		throw new Error(
			`Motion Canvas produced ${frames.length}/${frameCount} frames`,
		);
	const frameDirectory = path.dirname(frames[0] ?? "");
	if (!frames.every((frame) => path.dirname(frame) === frameDirectory))
		throw new Error(
			"Motion Canvas emitted frames in multiple scene directories",
		);
	const selectedFrames = frames.slice(0, frameCount);
	for (let index = 1; index < selectedFrames.length; index++) {
		if (
			numericFrameNumber(selectedFrames[index] ?? "") !==
			numericFrameNumber(selectedFrames[index - 1] ?? "") + 1
		) {
			throw new Error("Motion Canvas frame sequence contains a gap");
		}
	}
	const listPath = path.join(workspace, "frames.concat.txt");
	const frameDuration = (1 / fps).toFixed(9);
	const concatLines = selectedFrames.flatMap((frame) => [
		`file ${ffmpegConcatQuote(frame)}`,
		`duration ${frameDuration}`,
	]);
	const lastFrame = selectedFrames.at(-1);
	if (!lastFrame) throw new Error("Motion Canvas emitted no frames");
	concatLines.push(`file ${ffmpegConcatQuote(lastFrame)}`);
	await fs.writeFile(listPath, `${concatLines.join("\n")}\n`, "utf8");
	await run(
		[
			"ffmpeg",
			"-y",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			listPath,
			"-vsync",
			"cfr",
			"-frames:v",
			String(frameCount),
			"-r",
			String(fps),
			"-c:v",
			"libx264",
			"-crf",
			"18",
			"-pix_fmt",
			"yuvj420p",
			"-color_range",
			"pc",
			"-movflags",
			"+faststart",
			output,
		],
		workspace,
	);
}

export async function renderMotionCanvasInput(
	inputValue: unknown,
	outputPath: string,
	workspacePath: string,
	options: { dryRun?: boolean; dependenciesReady?: boolean } = {},
): Promise<MotionCanvasRenderResult | null> {
	const input = ExperienceRenderInputSchema.parse(inputValue);
	const output = path.resolve(outputPath);
	const workspace = path.resolve(workspacePath);
	const { world } = await loadByosanExperienceConfig();
	const files = buildMotionCanvasWorkspaceFiles(input, world);
	await fs.ensureDir(workspace);
	for (const [relativePath, contents] of Object.entries(files)) {
		const target = path.join(workspace, relativePath);
		await fs.ensureDir(path.dirname(target));
		await fs.writeFile(target, contents, "utf8");
	}
	const sourceLines = Object.entries(files)
		.filter(([name]) => name.endsWith(".ts") || name.endsWith(".tsx"))
		.reduce(
			(count, [, contents]) => count + contents.split("\n").length - 1,
			0,
		);
	if (options.dryRun) {
		console.log(
			JSON.stringify(
				{
					workspace,
					input_items: input.items.map((item) => item.id),
					output,
					packages: JSON.parse(files["package.json"] ?? "{}"),
					custom_code_lines: sourceLines,
					image_sequence_frames: input.durationInFrames,
				},
				null,
				2,
			),
		);
		return null;
	}

	const productionClock = performance.now();
	await fs.emptyDir(path.join(workspace, "render-frames"));
	if (options.dependenciesReady) {
		for (const dependency of [
			"@motion-canvas/core",
			"playwright-core",
			"vite",
		]) {
			if (
				!(await fs.pathExists(
					path.join(workspace, "node_modules", dependency, "package.json"),
				))
			) {
				throw new Error(
					`prepared Motion Canvas workspace is missing ${dependency}`,
				);
			}
		}
	} else {
		await installBunWorkspace(workspace);
	}
	await run(["bun", "run", "typecheck"], workspace);
	const renderClock = performance.now();
	await renderFramesThroughEditor(workspace, input.durationInFrames);
	await fs.ensureDir(path.dirname(output));
	await encodeVideoFromFrames(
		workspace,
		output,
		input.fps,
		input.durationInFrames,
	);
	const renderSeconds = (performance.now() - renderClock) / 1000;
	const outputBuffer = await fs.readFile(output);
	const packageLock = path.join(workspace, "bun.lock");
	const dependencyLockBytes = (await fs.pathExists(packageLock))
		? (await fs.stat(packageLock)).size
		: null;
	return {
		production_seconds: (performance.now() - productionClock) / 1000,
		render_seconds: renderSeconds,
		output_bytes: outputBuffer.byteLength,
		output_sha256: createHash("sha256").update(outputBuffer).digest("hex"),
		custom_code_lines: sourceLines,
		dependency_lock_bytes: dependencyLockBytes,
	};
}

export async function renderEpisodeMotionCanvas(
	args: RenderMotionCanvasArgs,
): Promise<void> {
	const compiled = path.resolve(args.compiled);
	const inputPath = path.join(compiled, `render-input-${args.kind}.json`);
	const output = path.resolve(args.output);
	const input = ExperienceRenderInputSchema.parse(
		JSON.parse(await fs.readFile(inputPath, "utf8")),
	);
	const audioConcat = path.join(compiled, `audio-${args.kind}.concat.txt`);
	const workspace = path.join(compiled, "motion-canvas");
	if (args.dryRun) {
		await renderMotionCanvasInput(input, output, workspace, { dryRun: true });
		console.log(
			JSON.stringify(
				{
					muxCommand: (await fs.pathExists(audioConcat))
						? buildEpisodeMuxCommand(
								`${output}.visual.mp4`,
								audioConcat,
								output,
							)
						: null,
				},
				null,
				2,
			),
		);
		return;
	}
	const visualOutput = `${output}.visual.mp4`;
	await removeIfExists(visualOutput);
	await renderMotionCanvasInput(input, visualOutput, workspace);
	if (await fs.pathExists(audioConcat)) {
		try {
			await finalizeEpisodeVideo(visualOutput, audioConcat, output);
		} finally {
			await removeIfExists(visualOutput);
		}
	} else {
		await fs.move(visualOutput, output, { overwrite: true });
	}
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
	try {
		await renderEpisodeMotionCanvas(parseArgs(argv));
		console.log(JSON.stringify({ status: "DONE", engine: "motion-canvas" }));
		return 0;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

if (import.meta.main) process.exit(await main());
