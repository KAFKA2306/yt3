import { describe, expect, test } from "bun:test";
import { isFailoverEligibleError, routeChainFor } from "../src/io/creative.js";

describe("creative cross-provider automatic routing", () => {
	test("builds ordered zero-cost failover chains across codex and agy", () => {
		const titleChain = routeChainFor("title");
		expect(titleChain.length).toBe(2);
		expect(titleChain[0]?.provider).toBe("codex");
		expect(titleChain[1]?.provider).toBe("agy");

		const draftChain = routeChainFor("draft");
		expect(draftChain.length).toBe(2);
		expect(draftChain[0]?.provider).toBe("agy");
		expect(draftChain[1]?.provider).toBe("codex");
	});

	test("detects quota/rate-limit/capacity/outage errors for failover", () => {
		expect(
			isFailoverEligibleError(new Error("HTTP 429 Too Many Requests")),
		).toBe(true);
		expect(
			isFailoverEligibleError(new Error("MODEL_CAPACITY_EXHAUSTED on agy")),
		).toBe(true);
		expect(
			isFailoverEligibleError(new Error("Codex title exited 1: usage limit")),
		).toBe(true);
		expect(
			isFailoverEligibleError(new Error("ZodError: invalid schema field")),
		).toBe(false);
	});
});
