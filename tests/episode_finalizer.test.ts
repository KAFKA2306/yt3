import { describe, expect, test } from "bun:test";
import {
	buildEpisodeVideoQaCommand,
	parseEpisodeVideoQa,
} from "../src/domain/episode/finalizer.js";

describe("episode FFmpeg finalization", () => {
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
