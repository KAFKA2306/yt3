import { unlink } from "node:fs/promises";
import fs from "fs-extra";

function quoteConcatPath(value: string): string {
	return value.replaceAll("'", "'\\''");
}

export function buildAudioConcatFile(paths: string[]): string {
	if (paths.length === 0) throw new Error("audio concat requires at least one file");
	return `${paths.map((item) => `file '${quoteConcatPath(item)}'`).join("\n")}\n`;
}

export function buildEpisodeMuxCommand(
	visualPath: string,
	audioConcatPath: string,
	outputPath: string,
	ffmpeg = "ffmpeg",
): string[] {
	return [
		ffmpeg,
		"-y",
		"-f",
		"concat",
		"-safe",
		"0",
		"-i",
		audioConcatPath,
		"-i",
		visualPath,
		"-map",
		"1:v:0",
		"-map",
		"0:a:0",
		"-c:v",
		"copy",
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-shortest",
		outputPath,
	];
}

export function buildEpisodeVideoQaCommand(
	videoPath: string,
	ffmpeg = "ffmpeg",
): string[] {
	return [
		ffmpeg,
		"-hide_banner",
		"-v",
		"info",
		"-i",
		videoPath,
		"-vf",
		"blackdetect=d=1.0:pix_th=0.03,freezedetect=n=-50dB:d=4.0",
		"-an",
		"-f",
		"null",
		"-",
	];
}

export interface EpisodeVideoQaResult {
	blackSegments: number;
	freezeSegments: number;
}

export function parseEpisodeVideoQa(stderr: string): EpisodeVideoQaResult {
	return {
		blackSegments: (stderr.match(/black_start:/g) ?? []).length,
		freezeSegments: (stderr.match(/freeze_start:/g) ?? []).length,
	};
}

async function runCapture(command: string[]): Promise<string> {
	const child = Bun.spawn(command, {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "pipe",
	});
	const stderr = await new Response(child.stderr).text();
	const exitCode = await child.exited;
	if (exitCode !== 0)
		throw new Error(`command failed (${exitCode}): ${command.join(" ")}\n${stderr}`);
	return stderr;
}

export async function finalizeEpisodeVideo(
	visualPath: string,
	audioConcatPath: string,
	outputPath: string,
	ffmpeg = "ffmpeg",
): Promise<EpisodeVideoQaResult> {
	await runCapture(
		buildEpisodeMuxCommand(visualPath, audioConcatPath, outputPath, ffmpeg),
	);
	if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0)
		throw new Error("FFmpeg finalization produced no video");
	const qaLog = await runCapture(buildEpisodeVideoQaCommand(outputPath, ffmpeg));
	const qa = parseEpisodeVideoQa(qaLog);
	if (qa.blackSegments > 0 || qa.freezeSegments > 0) {
		throw new Error(
			`episode video QA failed: black=${qa.blackSegments}, freeze=${qa.freezeSegments}`,
		);
	}
	return qa;
}

export async function removeIfExists(filePath: string): Promise<void> {
	if (fs.existsSync(filePath)) await unlink(filePath);
}
