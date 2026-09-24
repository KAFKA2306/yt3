import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import { parseAndAuditByosanFeatureSpec } from "../src/domain/byosan/feature_spec.js";

const dossierFiles = [
	"issue_130_semiconductor_funds.json",
	"issue_131_ai_infrastructure_bottlenecks.json",
	"issue_132_autonomous_capital.json",
	"issue_133_boj_usdjpy.json",
	"issue_134_optical_switch_map.json",
	"issue_135_silicon_photonics_cpo.json",
	"issue_136_nvidia_capital_loop.json",
	"issue_137_ai_datacenter_growth_map.json",
	"issue_138_google_finance_fallback.json",
	"issue_156_ai_datacenter_credit_risk.json",
];

describe("open issue production dossiers", () => {
	test("all ten content issues satisfy the byosan feature contract", () => {
		expect(dossierFiles).toHaveLength(10);
		for (const file of dossierFiles) {
			const spec = parseAndAuditByosanFeatureSpec(
				fs.readJsonSync(`config/productions/${file}`),
			);
			expect(spec.segments.length).toBe(20);
			expect(spec.sources.length).toBeGreaterThanOrEqual(3);
			expect(spec.claims.length).toBe(3);
			expect(spec.packaging?.claimIds).toHaveLength(3);
			expect(spec.disclaimer).toContain("売買");
			expect(spec.hookPromises).toContain("投資推奨ではない");
		}
	});
});
