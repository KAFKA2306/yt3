import { describe, expect, test } from "bun:test";
import {
	auditVisualDesignLiterals,
	scanVisualDesignLiterals,
} from "../src/scripts/audit_visual_design_literals.js";

describe("visual design literal audit", () => {
	test("rejects viewer-facing hex and percentage literals", () => {
		const violations = scanVisualDesignLiterals(
			'const style = { color: "#123456", width: "80%" };',
			"fixture.ts",
		);
		expect(violations.map((item) => item.rule)).toEqual([
			"direct-hex",
			"percentage-layout",
		]);
	});

	test("passes the migrated viewer-facing renderers", () => {
		expect(auditVisualDesignLiterals()).toEqual([]);
	});
});
