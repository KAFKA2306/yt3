import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

describe("effective no-fallback inputs", () => {
	test("active Byosan loop memory contains no fallback entries", () => {
		const memory = fs.readJsonSync(
			"data/memory/byosan_money/loop_journal.json",
		) as {
			entries?: Array<{ kind?: string; summary?: string; fixes?: string[] }>;
		};
		for (const entry of memory.entries ?? []) {
			expect(entry.kind).not.toBe("fallback");
			expect(entry.summary ?? "").not.toMatch(/fallback-safe\s+synthesis/i);
			expect((entry.fixes ?? []).join(" ")).not.toMatch(
				/fallback-safe\s+synthesis/i,
			);
		}
	});
});
