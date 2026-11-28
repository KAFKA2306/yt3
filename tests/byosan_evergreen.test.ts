import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import {
	buildComparisonBarsSvg,
	buildIfThenSvg,
	buildPercentageSvg,
} from "../src/domain/byosan/evergreen_visuals.js";
import {
	type ByosanFeatureSpec,
	parseAndAuditByosanFeatureSpec,
} from "../src/domain/byosan/feature_spec.js";
import { getByosanProductionConfig } from "../src/domain/byosan/production_config.js";
import { assertByosanEvergreenSpec } from "../src/scripts/byosan_evergreen.js";

const SPEC_PATH = "config/productions/byosan_evergreen_investment_rules.json";
const loadSpec = (): ByosanFeatureSpec =>
	parseAndAuditByosanFeatureSpec(fs.readJsonSync(SPEC_PATH));

describe("Byosan evergreen production", () => {
	test("the canonical narration uses one installed and verified voice", () => {
		const config = getByosanProductionConfig();
		expect(config.providers.tts.voicevox.speakers).toEqual({ 青山龍星: 13 });
		expect(config.feature_production.tts.voice_controls).toMatchObject({
			speedScale: 0.95,
			pitchScale: -0.02,
			intonationScale: 1.08,
		});
		expect(config.feature_production.tts).not.toHaveProperty("speaker_caps");
		expect(config.feature_production.tts).not.toHaveProperty("voice_presets");
	});

	test("the publishable script uses the two-rule evergreen structure", () => {
		const spec = loadSpec();
		expect(() => assertByosanEvergreenSpec(spec)).not.toThrow();
		expect(spec.production?.format).toBe("evergreen");
		expect(spec.segments.length).toBeGreaterThanOrEqual(18);
		expect(
			spec.segments.filter(({ visualType }) => visualType === "if_then"),
		).toHaveLength(3);
		const coreRule = spec.segments.find(({ headline }) =>
			headline.includes("コア積立"),
		);
		const rebalanceRule = spec.segments.find(({ headline }) =>
			headline.includes("暴落リバランス"),
		);
		expect(coreRule?.text).toContain("定期買付日");
		expect(coreRule?.text).toContain("価格の動きに関係なく");
		expect(rebalanceRule?.text).toContain("許容幅");
		expect(rebalanceRule?.text).toContain("現金や債券");
		expect(rebalanceRule?.text).toContain("目標に戻る分だけ");
		const decommission = spec.segments.find(({ section }) =>
			section.includes("裁量をゼロ"),
		);
		expect(decommission?.text).toContain("全廃");
	});

	test("public copy rejects volatile dates and retired strategies", () => {
		for (const forbidden of ["2026", "第3層", "Oaktree", "3.77%"] as const) {
			const spec = loadSpec();
			spec.title = `${spec.title} ${forbidden}`;
			expect(() => assertByosanEvergreenSpec(spec)).toThrow(
				"BYOSAN_EVERGREEN_FORBIDDEN_COPY",
			);
		}
	});

	test("structural visuals render clear IF/THEN, percentages and comparisons", () => {
		const spec = loadSpec();
		const ifThen = spec.segments.find(
			({ visualType }) => visualType === "if_then",
		);
		const percentage = spec.segments.find(
			({ visualType, stats }) =>
				visualType === "percentage_bar" && stats[0]?.value === "76%",
		);
		const comparison = spec.segments.find(
			({ visualType, stats }) =>
				visualType === "comparison_bars" &&
				stats.some(({ value }) => value === "$170,555"),
		);
		if (!ifThen || !percentage || !comparison) {
			throw new Error("evergreen structural visual fixture is incomplete");
		}
		const ruleSvg = buildIfThenSvg(ifThen);
		const percentSvg = buildPercentageSvg(percentage);
		const comparisonSvg = buildComparisonBarsSvg(comparison);
		expect(ruleSvg).toContain(">IF</text>");
		expect(ruleSvg).toContain(">THEN</text>");
		expect(percentSvg).toContain(">76%</text>");
		expect(comparisonSvg).toContain("$170,555");
		expect(comparisonSvg).toContain("$186,077");
	});
});
