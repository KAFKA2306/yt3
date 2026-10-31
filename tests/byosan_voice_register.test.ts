import { describe, expect, test } from "bun:test";
import {
	capVoiceControls,
	type VoiceRegisterMeasurement,
	voiceRegisterPasses,
} from "../src/domain/byosan/voice_register.js";

const preset = {
	speedScale: 1.1,
	pitchScale: 0.035,
	intonationScale: 1.28,
	volumeScale: 0.98,
	prePhonemeLength: 0.08,
	postPhonemeLength: 0.22,
	pauseLengthScale: 1.05,
	outputSamplingRate: 48000,
};

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

describe("capVoiceControls", () => {
	test("lowers pitch and intonation to the speaker cap when the preset exceeds it", () => {
		const capped = capVoiceControls(preset, {
			pitchScale: 0,
			intonationScale: 1.1,
		});
		expect(capped.pitchScale).toBe(0);
		expect(capped.intonationScale).toBe(1.1);
	});

	test("keeps pitch and intonation of a preset that is already below the cap", () => {
		const capped = capVoiceControls(
			{ ...preset, pitchScale: -0.025, intonationScale: 1.12 },
			{ pitchScale: 0, intonationScale: 1.1 },
		);
		expect(capped.pitchScale).toBe(-0.025);
		expect(capped.intonationScale).toBe(1.1);
	});

	test("leaves every control unchanged when the speaker has no cap", () => {
		expect(capVoiceControls(preset, {})).toEqual(preset);
	});

	test("keeps the other controls unchanged when a cap applies", () => {
		const capped = capVoiceControls(preset, { intonationScale: 1.1 });
		expect(capped).toEqual({ ...preset, intonationScale: 1.1 });
	});
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
