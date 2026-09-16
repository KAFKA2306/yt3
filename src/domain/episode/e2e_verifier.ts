import type { EpisodeShortPlan, EpisodeTimelineItem } from "./compiler.js";
import {
	EPISODE_FONT_FAMILY,
	NOTO_SANS_JP_VERSION,
	type RemotionRenderInput,
} from "./remotion_workspace.js";

const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u9fff]/u;

export const REQUIRED_EPISODE_TEMPLATES = [
	"title",
	"two-column",
	"comparison",
	"timeline",
	"number-highlight",
	"quote",
	"source-card",
	"image",
	"terminal",
	"github",
] as const;

export interface EpisodeMediaProbe {
	width: number;
	height: number;
	videoDurationMs: number;
	audioDurationMs: number;
	formatDurationMs: number;
}

function durationMs(value: unknown, label: string): number {
	if (typeof value !== "string") throw new Error(`${label} duration is missing`);
	const seconds = Number.parseFloat(value);
	if (!Number.isFinite(seconds) || seconds <= 0)
		throw new Error(`${label} duration is invalid: ${String(value)}`);
	return Math.round(seconds * 1000);
}

export function probeEpisodeMedia(
	filePath: string,
	ffprobe = "ffprobe",
): EpisodeMediaProbe {
	const result = Bun.spawnSync(
		[
			ffprobe,
			"-v",
			"error",
			"-show_entries",
			"stream=codec_type,width,height,duration:format=duration",
			"-of",
			"json",
			filePath,
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	if (result.exitCode !== 0) {
		throw new Error(
			`ffprobe failed for ${filePath}: ${result.stderr.toString().trim()}`,
		);
	}
	const parsed = JSON.parse(result.stdout.toString()) as {
		streams?: Array<{
			codec_type?: string;
			width?: number;
			height?: number;
			duration?: string;
		}>;
		format?: { duration?: string };
	};
	const video = parsed.streams?.find((stream) => stream.codec_type === "video");
	const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
	if (!video) throw new Error(`video stream is missing: ${filePath}`);
	if (!audio) throw new Error(`audio stream is missing: ${filePath}`);
	if (!video.width || !video.height)
		throw new Error(`video dimensions are missing: ${filePath}`);
	return {
		width: video.width,
		height: video.height,
		videoDurationMs: durationMs(video.duration, "video"),
		audioDurationMs: durationMs(audio.duration, "audio"),
		formatDurationMs: durationMs(parsed.format?.duration, "format"),
	};
}

export function assertMediaContract(
	probe: EpisodeMediaProbe,
	expected: { width: number; height: number },
	maxDriftMs = 100,
): { driftMs: number } {
	if (probe.width !== expected.width || probe.height !== expected.height) {
		throw new Error(
			`unexpected dimensions: ${probe.width}x${probe.height}, expected ${expected.width}x${expected.height}`,
		);
	}
	const driftMs = Math.abs(probe.videoDurationMs - probe.audioDurationMs);
	if (driftMs > maxDriftMs) {
		throw new Error(
			`audio/video duration drift ${driftMs}ms exceeds ${maxDriftMs}ms`,
		);
	}
	return { driftMs };
}

export function assertTimelineContract(
	timeline: EpisodeTimelineItem[],
	fps: number,
): void {
	if (timeline.length < 3) throw new Error("E2E timeline must contain at least 3 scenes");
	const durationSet = new Set<number>();
	for (let index = 0; index < timeline.length; index++) {
		const item = timeline[index];
		if (!item) continue;
		const durationMsValue = item.endMs - item.startMs;
		durationSet.add(durationMsValue);
		if (index > 0) {
			const previous = timeline[index - 1];
			if (
				previous &&
				(item.startMs !== previous.endMs || item.startFrame !== previous.endFrame)
			) {
				throw new Error(`timeline gap or overlap before ${item.dialogueId}`);
			}
		}
		const renderedMs = ((item.endFrame - item.startFrame) / fps) * 1000;
		if (Math.abs(renderedMs - durationMsValue) > 1000 / fps) {
			throw new Error(`frame rounding exceeds one frame for ${item.dialogueId}`);
		}
	}
	if (durationSet.size < 3)
		throw new Error("E2E timeline must contain at least 3 distinct audio durations");
}

export function assertTemplateCoverage(input: RemotionRenderInput): void {
	const actual = new Set(input.items.map((item) => item.visual.type));
	for (const template of REQUIRED_EPISODE_TEMPLATES) {
		if (!actual.has(template)) throw new Error(`template was not rendered: ${template}`);
	}
}

export function assertShortContract(
	plan: EpisodeShortPlan,
	input: RemotionRenderInput,
): void {
	if (plan.dialogue_ids.length < 3)
		throw new Error("Short E2E fixture must contain hook/highlight/CTA scenes");
	const roles = input.items.map((item) => item.shortRole);
	if (roles[0] !== "HOOK") throw new Error("Short first scene must be HOOK");
	if (!roles.includes("HIGHLIGHT"))
		throw new Error("Short must include a HIGHLIGHT scene");
	if (roles.at(-1) !== "CTA") throw new Error("Short last scene must be CTA");
	for (const item of input.items) {
		if (!plan.dialogue_ids.includes(item.id))
			throw new Error(`Short scene lost dialogue provenance: ${item.id}`);
	}
}

export function assertEnglishLocale(strings: Record<string, string>): void {
	const remaining = Object.entries(strings).filter(([, value]) =>
		JAPANESE_TEXT.test(value),
	);
	if (remaining.length > 0) {
		throw new Error(
			`English locale still contains Japanese text: ${remaining.map(([key]) => key).join(", ")}`,
		);
	}
}

export function assertDeterministicFontContract(
	workspaceFiles: Record<string, string>,
): void {
	const packageJson = JSON.parse(workspaceFiles["package.json"] ?? "{}") as {
		dependencies?: Record<string, string>;
	};
	if (
		packageJson.dependencies?.["@fontsource-variable/noto-sans-jp"] !==
		NOTO_SANS_JP_VERSION
	) {
		throw new Error("pinned self-hosted Noto Sans JP dependency is missing");
	}
	const entry = workspaceFiles["entry.tsx"] ?? "";
	for (const required of [
		'import "@fontsource-variable/noto-sans-jp"',
		EPISODE_FONT_FAMILY,
		"document.fonts.load",
		"document.fonts.check",
		"CJK font contract failed",
	]) {
		if (!entry.includes(required))
			throw new Error(`deterministic font contract is missing: ${required}`);
	}
}

export function buildRepresentativeFrameCommand(
	videoPath: string,
	outputPath: string,
	seconds: number,
	ffmpeg = "ffmpeg",
): string[] {
	return [
		ffmpeg,
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-ss",
		seconds.toFixed(3),
		"-i",
		videoPath,
		"-frames:v",
		"1",
		outputPath,
	];
}
