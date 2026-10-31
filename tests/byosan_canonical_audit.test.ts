import { describe, expect, test } from "bun:test";
import {
	buildCanonicalAudit,
	type CanonicalAuditInput,
} from "../src/domain/byosan/canonical_audit.js";

const passing: CanonicalAuditInput = {
	claims: [{ id: "c1", sourceIds: ["s1"], status: "verified" }],
	sources: [{ id: "s1", url: "https://www.boj.or.jp/mopo/outlook/index.htm" }],
	explanationIssues: [],
	allowedHosts: ["boj.or.jp"],
	productionReport: {
		path: "audit/production_quality_report.json",
		decision: "PASS",
		requirements: { audio_quality: { status: "PASS" } },
	},
	specPath: "source/feature_spec.json",
	explanationPath: "source/explanation.json",
};

describe("byosan canonical audit", () => {
	test("passes every factual, provenance, and playable-artifact check", () => {
		const checks = buildCanonicalAudit(passing);
		expect(Object.keys(checks).sort()).toEqual([
			"factual_integrity",
			"production_quality",
			"provenance",
		]);
		for (const check of Object.values(checks)) {
			expect(check.status).toBe("PASS");
			expect(check.critical).toBe(true);
			expect(check.type).toBe("DETERMINISTIC");
		}
	});

	test("fails production quality when the decision or a requirement is not PASS", () => {
		const checks = buildCanonicalAudit({
			...passing,
			productionReport: {
				...passing.productionReport,
				requirements: { video_quality: { status: "FAIL" } },
			},
		});
		expect(checks.production_quality?.status).toBe("FAIL");
		expect(checks.production_quality?.details).toContain("video_quality=FAIL");
	});

	test("fails factual integrity for a claim with no resolvable source", () => {
		const checks = buildCanonicalAudit({
			...passing,
			claims: [{ id: "c9", sourceIds: ["missing"], status: "verified" }],
		});
		expect(checks.factual_integrity?.status).toBe("FAIL");
		expect(checks.factual_integrity?.details).toContain("c9");
	});

	test("fails factual integrity when the explanation contract reports an issue", () => {
		const checks = buildCanonicalAudit({
			...passing,
			explanationIssues: ["explanation_figure_value_missing:＋2.1％"],
		});
		expect(checks.factual_integrity?.status).toBe("FAIL");
		expect(checks.factual_integrity?.details).toContain("＋2.1％");
	});

	test("fails provenance for a source host outside the allowlist", () => {
		const checks = buildCanonicalAudit({
			...passing,
			sources: [{ id: "s1", url: "https://example.com/report" }],
		});
		expect(checks.provenance?.status).toBe("FAIL");
		expect(checks.provenance?.details).toContain("example.com");
	});

	test("accepts subdomains of an allowlisted host", () => {
		const checks = buildCanonicalAudit({
			...passing,
			sources: [
				{ id: "s1", url: "https://www.dlri.co.jp/report/macro/1.html" },
			],
			allowedHosts: ["dlri.co.jp"],
		});
		expect(checks.provenance?.status).toBe("PASS");
	});
});
