import { describe, expect, test } from "bun:test";
import {
	buildAudioConcatFile,
	buildEpisodeMuxCommand,
	buildEpisodeVideoQaCommand,
	parseEpisodeVideoQa,
} from "../src/domain/episode/finalizer.js";

describe("episode FFmpeg finalization", () => {
	test("builds ordered concat input without a shell command", () => {
		const text = buildAudioConcatFile(["/tmp/a.wav", "/tmp/b.wav"]);
		expect(text.indexOf("a.wav")).toBeLessThan(text.indexOf("b.wav"));
		expect(text).toEndWith("\n");
	});

	test("muxes rendered video with concatenated episode audio", () => {
		const command = buildEpisodeMuxCommand(
			"visual.mp4",
			"audio.concat.txt",
			"final.mp4",
		);
		expect(command[0]).toBe("ffmpeg");
		expect(command).toContain("visual.mp4");
		expect(command).toContain("audio.concat.txt");
		expect(command).toContain("final.mp4");
		expect(command).toContain("copy");
		expect(command).toContain("aac");
	});

	test("uses the repository black/freeze QA thresholds", () => {
		const command = buildEpisodeVideoQaCommand("final.mp4");
		expect(command).toContain(
			"blackdetect=d=1.0:pix_th=0.03,freezedetect=n=-50dB:d=4.0",
		);
		expect(parseEpisodeVideoQa("clean")).toEqual({
			blackSegments: 0,
			freezeSegments: 0,
		});
		expect(
			parseEpisodeVideoQa("black_start:1 freeze_start:2 black_start:3"),
		).toEqual({ blackSegments: 2, freezeSegments: 1 });
	});
});
