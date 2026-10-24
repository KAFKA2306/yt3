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
	test("assigns visual kinds from the configured rule table", () => {
		const kinds = compileScenes(source, explanation, config).map(
			(scene) => scene.visual.kind,
		);
		expect(kinds).toEqual([
			"question",
			"bignumber",
			"hbar_compare",
			"stat_cards",
			"line_series",
			"bar_trend",
			"question",
		]);
	});

	test("draws series from explanation figures and comparisons from stats", () => {
		const scenes = compileScenes(source, explanation, config);
		expect(scenes[2]?.visual).toEqual({
			kind: "hbar_compare",
			items: [
				{
					label: "営業利益",
					value: { source: "stat", segmentIndex: 2, statIndex: 0 },
				},
				{
					label: "AWS売上",
					value: { source: "stat", segmentIndex: 2, statIndex: 1 },
				},
			],
		});
		expect(scenes[4]?.visual).toEqual({
			kind: "line_series",
			items: [
				{
					label: "2026年3月期",
					value: { source: "figure", figureIndex: 0 },
				},
				{
					label: "2026年6月期",
					value: { source: "figure", figureIndex: 1 },
				},
				{
					label: "2026年9月期",
					value: { source: "figure", figureIndex: 2 },
				},
			],
		});
	});

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

	test("reports same-kind runs longer than the configured limit", () => {
		const scenes = compileScenes(source, explanation, config);
		const [, , hbar, statCards, line] = scenes;
		if (!hbar || !statCards || !line) throw new Error("fixture scenes missing");
		hbar.visual = statCards.visual;
		line.visual = statCards.visual;
		expect(auditScenes(scenes, source, explanation, config)).toEqual([
			{ code: "consecutive_same_kind", details: "scene_04:stat_cards:3" },
		]);
	});

	test("reports too few distinct kinds against the configured minimum", () => {
		expect(
			auditScenes(
				compileScenes(source, explanation, config),
				source,
				explanation,
				{ ...config, min_distinct_kinds: 7 },
			),
		).toEqual([{ code: "distinct_kinds_too_few", details: "6<7" }]);
	});

	test("throws when the scene count exceeds the configured maximum", () => {
		expect(() =>
			compileScenes(source, explanation, { ...config, max_scenes: 6 }),
		).toThrow("BYOSAN_SCENE_COUNT_EXCEEDED");
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

	test("takes assignment solely from the rule table passed in", () => {
		const statCardsOnly: ByosanScenesConfig = {
			...config,
			rules: [
				{
					kind: "question",
					emphasis: "none",
					when: { visual_type_in: ["question"], stat_count_max: 0 },
				},
				{
					kind: "stat_cards",
					emphasis: "none",
					when: { stat_count_min: 1 },
				},
			],
		};
		expect(
			compileScenes(source, explanation, statCardsOnly).map(
				(scene) => scene.visual.kind,
			),
		).toEqual([
			"question",
			"stat_cards",
			"stat_cards",
			"stat_cards",
			"stat_cards",
			"stat_cards",
			"question",
		]);
	});
});
