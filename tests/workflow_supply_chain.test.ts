import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

describe("reusable workflow supply-chain pinning", () => {
	test("write-capable external reusable workflows use immutable revisions", () => {
		const workflow = fs.readFileSync(
			".github/workflows/weekly-repo-research.yml",
			"utf8",
		);
		expect(workflow).toContain("contents: write");
		expect(workflow).not.toMatch(
			/uses:\s+KAFKA2306\/agent-resources\/\.github\/workflows\/[^\s]+@(main|master|v\d+)\b/,
		);
		expect(workflow).toMatch(
			/uses:\s+KAFKA2306\/agent-resources\/\.github\/workflows\/[^\s]+@[0-9a-f]{40}\b/,
		);
	});
});
