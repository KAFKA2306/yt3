import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import yaml from "js-yaml";
import { z } from "zod";
import {
	type ByosanAuthenticityAuditConfig,
	ByosanAuthenticityAuditConfigSchema,
	type ByosanPreviousRun,
	auditAuthenticity,
} from "../src/domain/byosan/authenticity_audit.js";
import type { Explanation } from "../src/domain/byosan/explanation.js";
import {
	ByosanFeatureClaimSchema,
	ByosanFeatureSegmentSchema,
	ByosanFeatureSourceSchema,
} from "../src/domain/byosan/feature_spec.js";
import type {
	ByosanSceneKind,
	ByosanSceneSpec,
	ByosanSceneVisual,
} from "../src/domain/byosan/scene_spec.js";

type Segment = ReturnType<typeof ByosanFeatureSegmentSchema.parse>;

const config: ByosanAuthenticityAuditConfig =
	ByosanAuthenticityAuditConfigSchema.parse(
		z
			.object({ scenes: z.unknown(), authenticity: z.unknown() })
			.parse(
				yaml.load(fs.readFileSync("config/domains/byosan_money.yaml", "utf8")),
			),
	);

const SOURCES = ByosanFeatureSourceSchema.array().parse([
	{ id: "fred", name: "FRED", url: "https://fred.stlouisfed.org/" },
	{ id: "bls", name: "BLS", url: "https://www.bls.gov/" },
]);

const CLAIMS = ByosanFeatureClaimSchema.array().parse([
	{
		id: "c1",
		claim: "失業率は公式統計で確認できる",
		sourceIds: ["fred"],
		status: "verified",
	},
	{
		id: "c2",
		claim: "雇用者数は公式統計で確認できる",
		sourceIds: ["bls"],
		status: "verified",
	},
	{
		id: "c3",
		claim: "政策金利は公式統計で確認できる",
		sourceIds: ["fred"],
		status: "verified",
	},
]);

const BASE_KINDS: ByosanSceneKind[] = [
	"bignumber",
	"hbar_compare",
	"line_series",
	"bar_trend",
	"bignumber",
	"hbar_compare",
	"line_series",
	"question",
];

const CLAIM_BY_INDEX = ["c1", "c1", "c2", "c2", "c3", "c3", "c3", "c3"];
const SOURCE_BY_CLAIM: Record<string, string> = {
	c1: "FRED",
	c2: "BLS",
	c3: "FRED",
};
const ROLE_BY_INDEX: Record<number, Segment["verificationRole"]> = {
	1: "presenter",
	3: "auditor",
	5: "resolution",
};

function figures(count: number): Explanation["figures"] {
	return Array.from({ length: count }, (_, index) => ({
		metric: "失業率",
		population: "米国の労働者",
		period: `2026年${index + 1}月`,
		unit: "%",
		value: `${index + 4}.${index}%`,
		quote: `失業率は${index + 4}.${index}%でした。`,
		kind: "actual" as const,
	}));
}

function visualOf(kind: ByosanSceneKind): ByosanSceneVisual {
	const items = [0, 1, 2].map((figureIndex) => ({
		label: `期${figureIndex}`,
		value: { source: "figure" as const, figureIndex },
	}));
	switch (kind) {
		case "question":
			return { kind, prompt: "次に何が起きるでしょうか" };
		case "bignumber":
			return {
				kind,
				label: "失業率",
				value: { source: "figure", figureIndex: 0 },
			};
		case "hbar_compare":
			return { kind, items };
		case "bar_trend":
			return { kind, items };
		case "line_series":
			return { kind, items };
		case "stat_cards":
			return { kind, items };
	}
}

function baseSegment(kind: ByosanSceneKind, index: number): Segment {
	const claimId = CLAIM_BY_INDEX[index] ?? "c3";
	return ByosanFeatureSegmentSchema.parse({
		verificationRole: ROLE_BY_INDEX[index],
		claimIds: [claimId],
		speaker: index % 2 === 0 ? "春日部つむぎ" : "ずんだもん",
		emotion: "analytical",
		section: "検証パート",
		headline: `見出し${index}`,
		subheadline: `補足${index}`,
		visualType: kind,
		stats: [],
		source: SOURCE_BY_CLAIM[claimId] ?? "FRED",
		text: `公式統計の数字を確認し、比較の基準を示します${index}。`,
	});
}

type Overrides = {
	kinds?: ByosanSceneKind[];
	claims?: (claims: typeof CLAIMS) => typeof CLAIMS;
	segments?: (segment: Segment, index: number) => Segment;
	scenes?: (scenes: ByosanSceneSpec[]) => ByosanSceneSpec[];
	figureCount?: number;
	previousRuns?: ByosanPreviousRun[];
};

function makeInput(overrides: Overrides = {}) {
	const kinds = overrides.kinds ?? BASE_KINDS;
	const segments = kinds.map((kind, index) => {
		const segment = baseSegment(kind, index);
		return overrides.segments ? overrides.segments(segment, index) : segment;
	});
	const scenes: ByosanSceneSpec[] = segments.map((segment, index) => ({
		sceneId: `scene_${String(index).padStart(2, "0")}`,
		segmentIndexes: [index],
		understandingGoal: segment.headline,
		claimIds: segment.claimIds ?? [],
		visual: visualOf(kinds[index] ?? "question"),
		emphasis: { type: "none" as const },
		durationHint: 5,
	}));
	return {
		scenes: overrides.scenes ? overrides.scenes(scenes) : scenes,
		featureSpec: {
			claims: overrides.claims ? overrides.claims(CLAIMS) : CLAIMS,
			segments,
			sources: SOURCES,
		},
		explanation: { figures: figures(overrides.figureCount ?? 3) },
		previousRuns: overrides.previousRuns ?? [],
		config,
	};
}

function codesOf(overrides: Overrides): string[] {
	return auditAuthenticity(makeInput(overrides)).violations.map(
		(issue) => issue.code,
	);
}

function warningsOf(overrides: Overrides): string[] {
	return auditAuthenticity(makeInput(overrides)).warnings.map(
		(issue) => issue.code,
	);
}

describe("byosan authenticity audit", () => {
	test("passes a sourced, multi-kind run with independent verification", () => {
		const result = auditAuthenticity(makeInput());
		expect(result.status).toBe("PASS");
		expect(result.violations).toEqual([]);
		expect(result.metrics.claims_displayed).toBe(3);
	});

	test("warns when the run uses fewer distinct scene kinds than configured", () => {
		expect(
			warningsOf({
				kinds: [
					"bignumber",
					"hbar_compare",
					"bignumber",
					"hbar_compare",
					"bignumber",
					"hbar_compare",
					"bignumber",
					"hbar_compare",
				],
			}),
		).toContain("distinct_kinds_too_few");
	});

	test("warns when one scene kind repeats beyond the configured run length", () => {
		expect(
			warningsOf({
				kinds: [
					"bignumber",
					"hbar_compare",
					"hbar_compare",
					"hbar_compare",
					"line_series",
					"bar_trend",
					"bignumber",
					"question",
				],
			}),
		).toContain("consecutive_same_kind_exceeded");
	});

	test("warns when generic scenes exceed the configured ratio", () => {
		expect(
			warningsOf({
				kinds: [
					"question",
					"stat_cards",
					"bignumber",
					"question",
					"stat_cards",
					"hbar_compare",
					"question",
					"stat_cards",
				],
			}),
		).toContain("generic_ratio_exceeded");
	});

	test("fails when a scene carries no verified claim", () => {
		expect(
			codesOf({
				scenes: (scenes) =>
					scenes.map((scene, index) =>
						index === 2 ? { ...scene, claimIds: [] } : scene,
					),
			}),
		).toContain("scene_claim_unverified");
	});

	test("fails when a scene references a claim missing from the spec", () => {
		expect(
			codesOf({
				scenes: (scenes) =>
					scenes.map((scene, index) =>
						index === 2 ? { ...scene, claimIds: ["unknown_claim"] } : scene,
					),
			}),
		).toContain("scene_claim_unverified");
	});

	test("fails when a scene exposes a third-party URL", () => {
		expect(
			codesOf({
				scenes: (scenes) =>
					scenes.map((scene, index) =>
						index === 7
							? {
									...scene,
									visual: {
										kind: "question",
										prompt: "詳しくは https://example.com を参照",
									},
								}
							: scene,
					),
			}),
		).toContain("third_party_reference");
	});

	test("fails when a claim's cited source never appears on screen", () => {
		expect(
			codesOf({
				segments: (segment, index) =>
					index === 2 || index === 3
						? { ...segment, source: "Reuters" }
						: segment,
			}),
		).toContain("claim_source_not_displayed");
	});

	test("fails when a claim has no id, so no scene can display its source", () => {
		expect(
			codesOf({
				claims: (claims) =>
					claims.map((claim) =>
						claim.id === "c2" ? { ...claim, id: undefined } : claim,
					),
			}),
		).toContain("claim_source_not_displayed");
	});

	test("warns when the auditor and resolution roles are absent", () => {
		expect(
			warningsOf({
				segments: (segment) => ({ ...segment, verificationRole: undefined }),
			}),
		).toContain("verification_sequence_missing");
	});

	test("warns when comparison scenes are fewer than the explanation figures", () => {
		expect(warningsOf({ figureCount: 6 })).toContain("comparison_scenes_short");
	});

	test("warns, without failing, when the sequence is nearly identical to a recently published run", () => {
		const result = auditAuthenticity(
			makeInput({
				previousRuns: [{ asOf: "2026-10-09", sequence: [...BASE_KINDS] }],
			}),
		);
		expect(result.status).toBe("PASS");
		expect(result.warnings.map((issue) => issue.code)).toContain(
			"history_similarity_exceeded",
		);
		expect(result.metrics.max_history_similarity).toBe(1);
	});

	test("passes when recent published runs have a dissimilar sequence", () => {
		const result = auditAuthenticity(
			makeInput({
				previousRuns: [
					{ asOf: "2026-10-09", sequence: Array(8).fill("list") },
					{ asOf: "2026-10-08", sequence: Array(8).fill("chart") },
				],
			}),
		);
		expect(result.status).toBe("PASS");
		expect(result.metrics.max_history_similarity).toBe(0);
	});
});
