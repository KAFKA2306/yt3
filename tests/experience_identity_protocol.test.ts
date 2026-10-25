import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { ExperienceWorldSchema } from "../src/domain/experience/schema.js";

const root = process.cwd();
const worldConfig = yaml.load(
	readFileSync(path.join(root, "config/channels/byosan/world.yaml"), "utf8"),
);

describe("Byosan single-frame identity protocol", () => {
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
