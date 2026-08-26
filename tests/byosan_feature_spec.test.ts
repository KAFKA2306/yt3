import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import {
	auditByosanFeatureSpec,
	centerLockedMotionFilter,
	parseAndAuditByosanFeatureSpec,
	quantizedCenterOrigin,
} from "../src/domain/byosan/feature_spec.js";

const SPEC_PATH = "config/productions/sp500_anthropic_2026q2.json";

describe("byosan feature specification", () => {
	test("the reference production satisfies the reusable schema", async () => {
		const spec = parseAndAuditByosanFeatureSpec(await fs.readJson(SPEC_PATH));
		expect(spec.segments.length).toBeGreaterThanOrEqual(20);
		expect(auditByosanFeatureSpec(spec)).toEqual([]);
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
