import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import {
	type ByosanFeatureSpec,
	type ByosanNarrativeRole,
	ByosanFeatureSpecSchema,
	auditByosanFeatureSpec,
	centerLockedMotionFilter,
	parseAndAuditByosanFeatureSpec,
	quantizedCenterOrigin,
} from "../src/domain/byosan/feature_spec.js";

const SPEC_PATH = "config/productions/sp500_anthropic_2026q2.json";

function productionAwareSpec(base: ByosanFeatureSpec): ByosanFeatureSpec {
	const claims = base.claims.map((claim, index) => ({
		...claim,
		id: `claim_${index}`,
		...(claim.status === "verified"
			? {}
			: { caveat: "推計または派生値であり、前提条件に依存する" }),
	}));
	const segments = base.segments.map((segment, index) => {
		const narrativeRole: ByosanNarrativeRole =
			index === 0
				? "fact"
				: index === 1
					? "context"
					: index === 2
						? "impact"
						: "action";
		return {
			...segment,
			narrativeRole,
			...(index === 0 ? { claimIds: ["claim_0"] } : {}),
		};
	});
	return {
		...base,
		title: "S&P500利益+47.4%の中身を一次資料で検証",
		claims,
		segments,
		production: {
			format: "regular",
			targetMinutes: 6,
			minSegments: 20,
			maxSegments: 28,
			reasons: ["weighted_score=80"],
		},
		packaging: {
			primaryClaimId: "claim_0",
			claimIds: ["claim_0", "claim_1", "claim_2"],
		},
		narrative: {
			hiddenMechanism:
				"巨大企業の非現金評価益が時価総額加重指数の集計利益を押し上げる",
			counterfactual:
				"AlphabetとAmazonを除いた場合の利益成長率を同じ分母で比較する",
			audiencePayoff: "見出し利益と本業成長を分けて投資判断に使える",
		},
	};
}

async function loadReferenceSpec(): Promise<ByosanFeatureSpec> {
	return ByosanFeatureSpecSchema.parse(await fs.readJson(SPEC_PATH));
}

describe("byosan feature specification", () => {
	test("the reference production satisfies the reusable schema", async () => {
		const spec = parseAndAuditByosanFeatureSpec(await fs.readJson(SPEC_PATH));
		expect(spec.segments.length).toBeGreaterThanOrEqual(20);
		expect(auditByosanFeatureSpec(spec)).toEqual([]);
	});

	test("production-aware specs enforce grounded packaging and Fact -> Context -> Impact", async () => {
		const spec = productionAwareSpec(await loadReferenceSpec());
		expect(auditByosanFeatureSpec(spec)).toEqual([]);
		expect(parseAndAuditByosanFeatureSpec(spec).production?.format).toBe(
			"regular",
		);
	});

	test("unsupported breaking and extreme wording fail closed", async () => {
		const spec = productionAwareSpec(await loadReferenceSpec());
		spec.title = "【速報】過去最大のS&P500利益+47.4%";
		const issues = auditByosanFeatureSpec(spec);
		expect(issues.map((issue) => issue.code)).toContain(
			"freshness_marker_ungrounded",
		);
		expect(issues.map((issue) => issue.code)).toContain(
			"relative_claim_ungrounded",
		);
	});

	test("fact segments require claim grounding under the new narrative contract", async () => {
		const spec = productionAwareSpec(await loadReferenceSpec());
		const first = spec.segments[0];
		if (!first) throw new Error("reference spec has no first segment");
		const { claimIds, ...ungroundedFirst } = first;
		expect(claimIds).toEqual(["claim_0"]);
		spec.segments = [ungroundedFirst, ...spec.segments.slice(1)];
		expect(auditByosanFeatureSpec(spec).map((issue) => issue.code)).toContain(
			"fact_segment_claim_missing",
		);
	});

	test("motion keeps crop origins on the even-pixel chroma grid", () => {
		const filter = centerLockedMotionFilter();
		expect(filter).toContain("floor((iw-iw/zoom)/4)*2");
		expect(filter).toContain("floor((ih-ih/zoom)/4)*2");
		expect(filter).not.toMatch(/sin|cos/);
	});

	test("quantized center origins move monotonically without vertical sign reversal", () => {
		const zooms = Array.from({ length: 901 }, (_, index) => 1 + index * 0.0002);
		const verticalOrigins = zooms.map((zoom) =>
			quantizedCenterOrigin(1080, zoom),
		);
		for (let index = 1; index < verticalOrigins.length; index++) {
			expect(verticalOrigins[index]).toBeGreaterThanOrEqual(
				verticalOrigins[index - 1] ?? 0,
			);
			expect((verticalOrigins[index] ?? 0) % 2).toBe(0);
		}
	});
});
