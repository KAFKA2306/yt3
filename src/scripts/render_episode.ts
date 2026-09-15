import path from "node:path";
import fs from "fs-extra";
import {
	buildEpisodeMuxCommand,
	buildEpisodeVideoQaCommand,
	finalizeEpisodeVideo,
	removeIfExists,
} from "../domain/episode/finalizer.js";
import { buildRemotionRenderCommand } from "../domain/episode/remotion_workspace.js";

export interface RenderEpisodeArgs {
	compiled: string;
	kind: "main" | "short";
	output: string;
	dryRun: boolean;
}

function parseArgs(argv: string[]): RenderEpisodeArgs {
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

export async function renderEpisode(args: RenderEpisodeArgs): Promise<void> {
	const compiled = path.resolve(args.compiled);
	const workspace = path.join(compiled, "remotion");
	const inputFile = path.join(compiled, `render-input-${args.kind}.json`);
	const audioConcat = path.join(compiled, `audio-${args.kind}.concat.txt`);
	const output = path.resolve(args.output);
	const visualOutput = `${output}.visual.mp4`;
	if (!fs.existsSync(path.join(workspace, "package.json")))
		throw new Error("compiled Remotion workspace is missing");
	if (!fs.existsSync(inputFile))
		throw new Error(`render input is missing: ${inputFile}`);
	if (!fs.existsSync(audioConcat))
		throw new Error(`audio concat is missing: ${audioConcat}`);
	fs.ensureDirSync(path.dirname(output));
	const renderCommand = buildRemotionRenderCommand(inputFile, visualOutput);
	if (args.dryRun) {
		console.log(
			JSON.stringify(
				{
					workspace,
					renderCommand,
					muxCommand: buildEpisodeMuxCommand(visualOutput, audioConcat, output),
					qaCommand: buildEpisodeVideoQaCommand(output),
				},
				null,
				2,
			),
		);
		return;
	}
	await run(["bun", "install", "--no-save"], workspace);
	await removeIfExists(visualOutput);
	await run(renderCommand, workspace);
	if (!fs.existsSync(visualOutput) || fs.statSync(visualOutput).size === 0)
		throw new Error("Remotion render produced no video");
	try {
		await finalizeEpisodeVideo(visualOutput, audioConcat, output);
	} finally {
		await removeIfExists(visualOutput);
	}
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
	try {
		await renderEpisode(parseArgs(argv));
		console.log(JSON.stringify({ status: "DONE" }));
		return 0;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

if (import.meta.main) process.exit(await main());
