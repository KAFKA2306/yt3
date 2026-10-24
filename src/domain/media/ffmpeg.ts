import { spawn } from "node:child_process";

export function runFfmpeg(args: readonly string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		proc.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		proc.on("error", reject);
		proc.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
		});
	});
}

export function probeDurationSeconds(filePath: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const proc = spawn(
			"ffprobe",
			[
				"-v",
				"error",
				"-show_entries",
				"format=duration",
				"-of",
				"default=noprint_wrappers=1:nokey=1",
				filePath,
			],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		proc.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		proc.on("error", reject);
		proc.on("close", (code) => {
			const duration = Number(stdout.trim());
			if (code === 0 && Number.isFinite(duration)) resolve(duration);
			else
				reject(
					new Error(`ffprobe failed for ${filePath} (code ${code}): ${stderr}`),
				);
		});
	});
}

export function buildConcatArgs(
	inputPaths: readonly string[],
	outputPath: string,
): string[] {
	return [
		...inputPaths.flatMap((inputPath) => ["-i", inputPath]),
		"-y",
		"-filter_complex",
		`concat=n=${inputPaths.length}:v=0:a=1`,
		outputPath,
	];
}

export function buildLoudnormArgs(
	inputPath: string,
	outputPath: string,
): string[] {
	return [
		"-i",
		inputPath,
		"-y",
		"-filter:a",
		"loudnorm=I=-14:TP=-3.0:LRA=11",
		outputPath,
	];
}
