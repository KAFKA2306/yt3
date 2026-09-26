import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { ExperienceWorldSchema } from "../src/domain/experience/schema.js";

const root = process.cwd();
const worldConfig = yaml.load(
	readFileSync(path.join(root, "config/channels/byosan/world.yaml"), "utf8"),
);

describe("Byosan single-frame identity protocol", () => {
	test("defines fixed markers and a repeatable blinded recognition procedure", () => {
		const world = ExperienceWorldSchema.parse(worldConfig);

		expect(world.identity.single_frame_recognition).toEqual({
			protocol_version: 1,
			fixed_markers: [
				"existing_character_asset",
				"palette.background",
				"palette.accent_primary",
			],
			frame_sample_rule: "midpoint_of_first_scene",
			blinded_fields: ["channel_name", "episode_title", "captions", "audio"],
			randomized_order: true,
			respondent_cohort: "self_reported_unfamiliar_viewers",
			answer_options: [
				"byosan_money",
				"humanity_observatory",
				"yawa_archive",
				"not_sure",
			],
			report_metrics: [
				"per_channel_top1_accuracy",
				"confusion_matrix",
				"wilson_95_percent_interval",
			],
			acceptance_threshold: null,
		});
	});

	test("rejects an incomplete or self-passing identity test protocol", () => {
		const world = ExperienceWorldSchema.parse(worldConfig);
		const { single_frame_recognition: protocol, ...identity } = world.identity;
		expect(protocol).toBeDefined();
		if (!protocol) throw new Error("canonical protocol is missing");

		expect(
			ExperienceWorldSchema.safeParse({
				...world,
				identity: {
					...identity,
					single_frame_recognition: {
						...protocol,
						fixed_markers: protocol.fixed_markers.slice(1),
					},
				},
			}).success,
		).toBe(false);

		expect(
			ExperienceWorldSchema.safeParse({
				...world,
				identity: {
					...identity,
					single_frame_recognition: {
						...protocol,
						fixed_markers: [
							protocol.fixed_markers[0],
							protocol.fixed_markers[1],
							protocol.fixed_markers[1],
						],
					},
				},
			}).success,
		).toBe(false);

		expect(
			ExperienceWorldSchema.safeParse({
				...world,
				identity: {
					...identity,
					single_frame_recognition: {
						...protocol,
						acceptance_threshold: 0.8,
					},
				},
			}).success,
		).toBe(false);

		const { accent_primary: _accent, ...paletteWithoutAccent } = world.palette;
		expect(
			ExperienceWorldSchema.safeParse({
				...world,
				palette: paletteWithoutAccent,
			}).success,
		).toBe(false);

		expect(
			ExperienceWorldSchema.safeParse({
				...world,
				identity: { ...identity, reuse_existing_asset: false },
			}).success,
		).toBe(false);
	});
});
