import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

describe("humanity pacing audit integrity", () => {
	test("deterministic multimodal pacing is never overwritten after measurement", () => {
		const source = fs.readFileSync("src/domain/agents/audit.ts", "utf8");
		expect(source).not.toContain(
			'signalResults.multimodal_pacing.status = "PASS"',
		);
		expect(source).not.toContain("Bypassed for ${state.bucket}");
		expect(source).toContain("Object.assign(results, signalResults)");
	});
});
