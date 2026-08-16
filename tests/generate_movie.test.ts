import { describe, expect, test } from "bun:test";
import {
	type RuntimeConfig,
	buildConcatFile,
	buildFfmpegCommand,
	buildGeneratorCommand,
	parseMoviePlan,
} from "../src/scripts/generate_movie.js";

const CONFIG: RuntimeConfig = {
	hfCacheHubRoot: "/models/hf-cache-hub",
	python: "python3",
	ffmpeg: "ffmpeg",
};

const PLAN = parseMoviePlan(
	JSON.stringify({
		output: "artifacts/generated/movie.mp4",
		model: "MiniMaxAI/H3",
		scenes: [
			{ id: "intro", prompt: "first scene", seed: 42, num_frames: 81 },
			{ id: "end", prompt: "last scene" },
		],
	}),
);
const FIRST_SCENE = PLAN.scenes[0];
if (!FIRST_SCENE) throw new Error("test plan must contain a scene");

describe("code-only movie generation", () => {
	test("parses a non-empty scene plan", () => {
		expect(PLAN.scenes).toHaveLength(2);
		expect(PLAN.output).toBe("artifacts/generated/movie.mp4");
	});

	test("rejects a plan with no scenes", () => {
		expect(() =>
			parseMoviePlan(JSON.stringify({ output: "movie.mp4", scenes: [] })),
		).toThrow();
	});

	test("builds generator argv without a shell command string", () => {
		const command = buildGeneratorCommand(
			PLAN,
			FIRST_SCENE,
			"/tmp/001-intro.mp4",
			CONFIG,
		);
		expect(command[0]).toBe("python3");
		expect(command).toContain("/models/hf-cache-hub/scripts/generate_video.py");
		expect(command).toContain("first scene");
		expect(command).toContain("MiniMaxAI/H3");
		expect(command).toContain("42");
		expect(command).toContain("81");
	});

	test("keeps scene order in the ffmpeg concat file", () => {
		const concat = buildConcatFile(["/tmp/001-intro.mp4", "/tmp/002-end.mp4"]);
		expect(concat.indexOf("001-intro.mp4")).toBeLessThan(
			concat.indexOf("002-end.mp4"),
		);
	});

	test("builds fail-fast ffmpeg concat argv", () => {
		expect(
			buildFfmpegCommand("/tmp/concat.txt", "movie.mp4", "ffmpeg"),
		).toEqual([
			"ffmpeg",
			"-y",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			"/tmp/concat.txt",
			"-c",
			"copy",
			"movie.mp4",
		]);
	});
});
