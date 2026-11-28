import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { ByosanVoiceRegisterConfig } from "./production_config.js";

const VoiceRegisterMeasurementSchema = z.object({
	path: z.string(),
	loud_frames: z.number().int().nonnegative(),
	f0_percentile_hz: z.number().nullable(),
	f0_max_hz: z.number().nullable(),
	jump_events: z.number().int().nonnegative(),
	clip_ratio: z.number().min(0).max(1),
});

export type VoiceRegisterMeasurement = z.infer<
	typeof VoiceRegisterMeasurementSchema
>;

export function measureVoiceRegister(
	wavPaths: string[],
	config: ByosanVoiceRegisterConfig,
): VoiceRegisterMeasurement[] {
	const stdout = execFileSync(
		"uv",
		[
			"run",
			"--frozen",
			"python",
			"src/scripts/byosan_voice_register.py",
			JSON.stringify({ ...config, paths: wavPaths }),
		],
		{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
	);
	return z.array(VoiceRegisterMeasurementSchema).parse(JSON.parse(stdout));
}

export function voiceRegisterPasses(
	measurement: VoiceRegisterMeasurement,
	maxHz: number,
): boolean {
	return (
		measurement.f0_percentile_hz !== null &&
		measurement.f0_percentile_hz <= maxHz
	);
}
