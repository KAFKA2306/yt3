import { describe, expect, test } from "bun:test";
import { repairResolutionIsValid } from "../src/scripts/byosan_daily.js";
import { buildRepairResolution } from "../src/scripts/byosan_resolve.js";

const head = "f0e1d2c3b4a5968778695a4b3c2d1e0f12345678";

const passing = {
	rootCause: "台本スキーマが全セグメントに数値カード1件以上を要求していた",
	regressionTest: "tests/byosan_feature_spec.test.ts",
	repairCommit: head,
	checkExitStatus: 0,
	checkedAt: "2026-10-24T05:00:00.000Z",
};

describe("byosan repair resolution", () => {
	test("builds a resolution that the retry guard accepts for the same head", () => {
		const resolution = buildRepairResolution(passing);
		expect(resolution.status).toBe("VERIFIED");
		expect(resolution.validation).toEqual({
			command: "task check:merge",
			status: "PASS",
			checked_at: passing.checkedAt,
		});
		expect(repairResolutionIsValid(resolution, head)).toBe(true);
	});

	test("rejects a resolution when the validation command failed", () => {
		expect(() =>
			buildRepairResolution({ ...passing, checkExitStatus: 1 }),
		).toThrow("REPAIR_VALIDATION_FAILED");
	});

	test("rejects a regression test outside the test directory", () => {
		expect(() =>
			buildRepairResolution({ ...passing, regressionTest: "src/scripts/x.ts" }),
		).toThrow("REGRESSION_TEST_INVALID");
	});

	test("rejects a regression test that is not a test file", () => {
		expect(() =>
			buildRepairResolution({
				...passing,
				regressionTest: "tests/helpers/fixture.json",
			}),
		).toThrow("REGRESSION_TEST_INVALID");
	});

	test("resolution does not satisfy the guard for a different head", () => {
		const resolution = buildRepairResolution(passing);
		expect(repairResolutionIsValid(resolution, "0".repeat(40))).toBe(false);
	});
});
