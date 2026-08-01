import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import {
	auditByosanFeatureSpec,
	centerLockedMotionFilter,
	parseAndAuditByosanFeatureSpec,
} from "../src/domain/byosan/feature_spec.js";

const SPEC_PATH = "config/productions/sp500_anthropic_2026q2.json";

describe("byosan feature specification", () => {
	test("the reference production satisfies the reusable schema", async () => {
		const spec = parseAndAuditByosanFeatureSpec(await fs.readJson(SPEC_PATH));
		expect(spec.segments.length).toBeGreaterThanOrEqual(20);
		expect(auditByosanFeatureSpec(spec)).toEqual([]);
	});

	test("motion is center locked and contains no periodic lateral oscillation", () => {
		const filter = centerLockedMotionFilter();
		expect(filter).toContain("iw/2-(iw/zoom/2)");
		expect(filter).toContain("ih/2-(ih/zoom/2)");
		expect(filter).not.toMatch(/sin|cos/);
	});
});
