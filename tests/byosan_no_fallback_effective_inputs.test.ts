import { describe, expect, test } from "bun:test";
import fs from "fs-extra";

describe("effective no-fallback inputs", () => {
	test("Byosan media fails closed when canonical character assets are missing", () => {
		const source = fs.readFileSync(
			"src/scripts/produce_byosan_feature.ts",
			"utf8",
		);
		expect(source).toContain("BYOSAN_CHARACTER_ASSET_MISSING");
		expect(source).not.toContain("fallbackCharacterSvg");
		expect(source).not.toContain("CHARACTER_FALLBACK");
	});

	test("no-fallback audit covers prompt memory and media fallback markers", () => {
		const source = fs.readFileSync(
			"src/scripts/audit_no_fallback_policy.ts",
			"utf8",
		);
		expect(source).toContain('"data/memory"');
		expect(source).toContain("/CHARACTER_FALLBACK/");
		expect(source).toContain("/fallbackCharacterSvg/");
		expect(source).toContain("/fallback-safe\\s+synthesis/i");
	});

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
