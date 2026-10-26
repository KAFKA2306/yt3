import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import * as yaml from "js-yaml";
import { z } from "zod";
import { ExplanationSchema } from "../src/domain/byosan/explanation.js";
import {
	ByosanFeatureClaimSchema,
	ByosanFeatureSegmentSchema,
} from "../src/domain/byosan/feature_spec.js";
import {
	type ByosanScenesConfig,
	ByosanScenesConfigSchema,
	compileScenes,
} from "../src/domain/byosan/scene_spec.js";

const FIXTURE_DIR = "tests/fixtures/byosan_scene_spec";

const source = {
	claims: ByosanFeatureClaimSchema.array().parse(
		fs.readJsonSync(`${FIXTURE_DIR}/feature_spec.json`).claims,
	),
	segments: ByosanFeatureSegmentSchema.array().parse(
		fs.readJsonSync(`${FIXTURE_DIR}/feature_spec.json`).segments,
	),
};
const explanation = ExplanationSchema.parse(
	fs.readJsonSync(`${FIXTURE_DIR}/explanation.json`),
);
const config: ByosanScenesConfig = z
	.object({ scenes: ByosanScenesConfigSchema })
	.parse(
		yaml.load(fs.readFileSync("config/domains/byosan_money.yaml", "utf8")),
	).scenes;

function withSegment(
	index: number,
	patch: Partial<(typeof source.segments)[number]>,
): typeof source {
	return {
		...source,
		segments: source.segments.map((segment, segmentIndex) =>
			segmentIndex === index ? { ...segment, ...patch } : segment,
		),
	};
}

describe("byosan scene spec", () => {
	test("compiles every segment into exactly one scene, in order", () => {
		expect(
			compileScenes(source, explanation, config).flatMap(
				(scene) => scene.segmentIndexes,
			),
		).toEqual(source.segments.map((_, index) => index));
	});

	test("falls back to stat cards when a stat carries a qualifier instead of a plain number", () => {
		const index = source.segments.findIndex(
			(segment) => segment.stats.length === 1,
		);
		const qualified = withSegment(index, {
			stats: (source.segments[index]?.stats ?? []).map((stat) => ({
				...stat,
				value: "more than 40%",
			})),
		});
		const kinds = compileScenes(qualified, explanation, config).map(
			(scene) => scene.visual.kind,
		);
		expect(kinds).not.toContain("bignumber");
	});

	test("a segment without a claim link takes the nearest linked segment's claims", () => {
		const scenes = compileScenes(
			withSegment(1, { claimIds: undefined }),
			explanation,
			config,
		);
		expect(scenes[1]?.claimIds.length).toBeGreaterThan(0);
	});

	test("throws when no segment has a claim link", () => {
		expect(() =>
			compileScenes(
				{
					...source,
					segments: source.segments.map((segment) => ({
						...segment,
						claimIds: undefined,
					})),
				},
				explanation,
				config,
			),
		).toThrow("BYOSAN_SCENE_CLAIM_MISSING");
	});
});
