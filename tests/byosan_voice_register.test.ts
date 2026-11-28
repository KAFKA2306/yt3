import { describe, expect, test } from "bun:test";
import {
	type VoiceRegisterMeasurement,
	voiceRegisterPasses,
} from "../src/domain/byosan/voice_register.js";

const measurement = (
	overrides: Partial<VoiceRegisterMeasurement> = {},
): VoiceRegisterMeasurement => ({
	path: "000-segment.wav",
	loud_frames: 900,
	f0_percentile_hz: 480,
	f0_max_hz: 520,
	jump_events: 0,
	clip_ratio: 0,
	...overrides,
});

describe("voiceRegisterPasses", () => {
	test("passes a segment whose loud pitch percentile is at the ceiling", () => {
		expect(
			voiceRegisterPasses(measurement({ f0_percentile_hz: 520 }), 520),
		).toBe(true);
	});

	test("fails a segment whose loud pitch percentile is above the ceiling", () => {
		expect(
			voiceRegisterPasses(measurement({ f0_percentile_hz: 561 }), 520),
		).toBe(false);
	});

	test("fails a segment without any loud voiced frame instead of passing it", () => {
		expect(
			voiceRegisterPasses(
				measurement({
					loud_frames: 0,
					f0_percentile_hz: null,
					f0_max_hz: null,
				}),
				520,
			),
		).toBe(false);
	});
});
