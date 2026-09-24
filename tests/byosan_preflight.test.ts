import { describe, expect, test } from "bun:test";
import { aggregateStatus } from "../src/scripts/byosan_preflight.js";

const item = (status: "PASS" | "FAIL" | "UNVERIFIED") => ({
	status,
	component: "test",
	method: "fixture",
	reason: "fixture",
	evidence: [],
});

describe("Byosan preflight aggregation", () => {
	test("fails closed on a known failure and keeps unknown capability separate", () => {
		expect(aggregateStatus({ a: item("PASS"), b: item("FAIL") })).toBe("FAIL");
		expect(aggregateStatus({ a: item("PASS"), b: item("UNVERIFIED") })).toBe(
			"UNVERIFIED",
		);
		expect(aggregateStatus({ a: item("PASS"), b: item("PASS") })).toBe("PASS");
	});
});
