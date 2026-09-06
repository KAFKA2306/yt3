import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

describe("Byosan full runtime gate", () => {
	test("UNVERIFIED preflight is a failing gate, not a successful workflow exit", () => {
		const source = fs.readFileSync(
			"src/scripts/verify_byosan_runtime.ts",
			"utf8",
		);
		expect(source).toContain("BYOSAN_RUNTIME_UNVERIFIED:");
		expect(source).not.toContain(
			'console.log(`BYOSAN_RUNTIME_UNVERIFIED=${reportPath}`);\n\t\treturn;',
		);
		expect(source).toContain("writeReport(reportPath, params)");
	});
});
