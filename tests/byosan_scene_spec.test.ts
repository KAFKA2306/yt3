import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import yaml from "js-yaml";
import { z } from "zod";
import { ExplanationSchema } from "../src/domain/byosan/explanation.js";
import {
	ByosanFeatureClaimSchema,
	ByosanFeatureSegmentSchema,
} from "../src/domain/byosan/feature_spec.js";
import {
	type ByosanScenesConfig,
	ByosanScenesConfigSchema,
	auditScenes,
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
	test("accepts compiled scenes under the configured audit", () => {
		expect(
			auditScenes(
				compileScenes(source, explanation, config),
				source,
				explanation,
				config,
			),
		).toEqual([]);
	});

	test("reports value references and claim ids that do not resolve", () => {
		const scenes = compileScenes(source, explanation, config);
		const bignumber = scenes[1];
		const question = scenes[6];
		if (!bignumber || !question) throw new Error("fixture scenes missing");
		bignumber.visual = {
			kind: "bignumber",
			label: "Amazon純利益",
			value: { source: "stat", segmentIndex: 99, statIndex: 0 },
		};
		question.claimIds = ["c_missing"];
		expect(
			auditScenes(scenes, source, explanation, config).map(
				(issue) => issue.code,
			),
		).toEqual(["value_ref_missing", "claim_missing"]);
	});

	test("throws when a segment matches no rule", () => {
		expect(() =>
			compileScenes(
				withSegment(1, { visualType: "chart", stats: [] }),
				explanation,
				config,
			),
		).toThrow("BYOSAN_SCENE_UNASSIGNABLE");
	});

	test("throws when a segment has no claim link", () => {
		expect(() =>
			compileScenes(
				withSegment(1, { claimIds: undefined }),
				explanation,
				config,
			),
		).toThrow("BYOSAN_SCENE_CLAIM_MISSING");
	});
});
