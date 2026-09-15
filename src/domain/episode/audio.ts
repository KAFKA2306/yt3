import type { Episode } from "./schema.js";

export function buildFfprobeDurationCommand(
	path: string,
	ffprobe = "ffprobe",
): string[] {
	return [
		ffprobe,
		"-v",
		"error",
		"-show_entries",
		"format=duration",
		"-of",
		"default=noprint_wrappers=1:nokey=1",
		path,
	];
}

export function probeAudioDurationMs(path: string, ffprobe = "ffprobe"): number {
	const result = Bun.spawnSync(buildFfprobeDurationCommand(path, ffprobe), {
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) {
		throw new Error(
			`ffprobe failed for ${path}: ${result.stderr.toString().trim()}`,
		);
	}
	const seconds = Number.parseFloat(result.stdout.toString().trim());
	if (!Number.isFinite(seconds) || seconds <= 0) {
		throw new Error(`ffprobe returned invalid duration for ${path}`);
	}
	return Math.round(seconds * 1000);
}

export function measureEpisodeAudio(
	episode: Episode,
	resolvePath: (path: string) => string = (path) => path,
	ffprobe = "ffprobe",
): Record<string, number> {
	const durations: Record<string, number> = {};
	for (const section of episode.sections) {
		for (const dialogue of section.dialogue) {
			durations[dialogue.id] = probeAudioDurationMs(
				resolvePath(dialogue.audio.path),
				ffprobe,
			);
		}
	}
	return durations;
}
