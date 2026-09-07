import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	type ByosanPromptInventory,
	auditByosanPromptInventory,
	auditByosanPromptMigration,
	detectByosanPromptPolicySignals,
	diffByosanPromptInventories,
	discoverByosanPromptInventory,
} from "../src/domain/byosan/prompt_migration.js";

function inventory(
	modelProfile: string,
	records: ByosanPromptInventory["records"],
): ByosanPromptInventory {
	return {
		schemaVersion: "byosan_prompt_inventory_v1",
		modelProfile,
		contractVersion: "prompt_migration_v1",
		generatedAt: "2026-09-07T03:00:00.000Z",
		records,
	};
}

function record(
	sourcePath: string,
	authority: "repository" | "system" | "developer",
	progressUpdates: "required" | "forbidden" | "unspecified",
	providerProfileApplicability = ["all"],
): ByosanPromptInventory["records"][number] {
	return {
		sourcePath,
		authority,
		promptHash: sourcePath
			.padEnd(64, "0")
			.slice(0, 64)
			.replaceAll(/[^a-f0-9]/g, "a"),
		providerProfileApplicability,
		contractVersion: "prompt_migration_v1",
		signals: {
			progressUpdates,
			confirmation: "unspecified",
		},
	};
}

describe("byosan prompt migration audit", () => {
	test("detects explicit progress-update contradiction", () => {
		const current = inventory("gemini-3", [
			record("AGENTS.md", "repository", "required"),
			record("src/agent.ts", "system", "forbidden"),
		]);
		const codes = auditByosanPromptInventory(current).map(
			(issue) => issue.code,
		);
		expect(codes).toContain("explicit_policy_conflict:progress_updates");
		expect(codes).toContain("repository_authority_conflict:progress_updates");
	});

	test("signal detector recognizes the migration failure fixture", () => {
		expect(
			detectByosanPromptPolicySignals(
				"長時間runでは進捗更新を必須として共有する",
			).progressUpdates,
		).toBe("required");
		expect(
			detectByosanPromptPolicySignals("途中経過の報告は禁止しない")
				.progressUpdates,
		).not.toBe("forbidden");
		expect(
			detectByosanPromptPolicySignals("途中経過の報告を禁止する")
				.progressUpdates,
		).toBe("forbidden");
	});

	test("model change that only adds prompt sources is warned", () => {
		const previous = inventory("gemini-2", [
			record("AGENTS.md", "repository", "required"),
		]);
		const current = inventory("gemini-3", [
			record("AGENTS.md", "repository", "required"),
			record("src/new_prompt.ts", "system", "required"),
		]);
		const audit = auditByosanPromptMigration(previous, current);
		expect(audit.diff?.modelProfileChanged).toBe(true);
		expect(audit.issues.map((issue) => issue.code)).toContain(
			"addition_only_model_migration",
		);
	});

	test("obsolete model-specific prompt sources are classified", () => {
		const current = inventory("gemini-3", [
			record("src/legacy.ts", "system", "unspecified", ["gpt"]),
		]);
		expect(
			auditByosanPromptInventory(current).map((issue) => issue.code),
		).toContain("obsolete_model_specific_patch");
	});

	test("inventory discovery records repository and system prompt hashes without raw prompt text", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "yt3-prompt-audit-"));
		try {
			fs.mkdirSync(path.join(root, "src"), { recursive: true });
			fs.writeFileSync(
				path.join(root, "AGENTS.md"),
				"進捗更新を必須として共有する",
			);
			fs.writeFileSync(
				path.join(root, "src", "agent.ts"),
				'const messages = [{ role: "system", content: "test" }];',
			);
			const found = discoverByosanPromptInventory(
				root,
				"gemini-3",
				new Date("2026-09-07T03:00:00Z"),
			);
			expect(found.records.map((item) => item.sourcePath)).toEqual([
				"AGENTS.md",
				"src/agent.ts",
			]);
			expect(found.records.every((item) => item.promptHash.length === 64)).toBe(
				true,
			);
			expect(JSON.stringify(found)).not.toContain('"content":"test"');
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test("inventory diff separates added removed and changed sources", () => {
		const previous = inventory("gemini-2", [
			record("AGENTS.md", "repository", "required"),
			record("src/removed.ts", "system", "unspecified"),
		]);
		const changed = {
			...record("AGENTS.md", "repository", "required"),
			promptHash: "b".repeat(64),
		};
		const current = inventory("gemini-3", [
			changed,
			record("src/added.ts", "system", "unspecified"),
		]);
		const diff = diffByosanPromptInventories(previous, current);
		expect(diff.added).toEqual(["src/added.ts:system"]);
		expect(diff.removed).toEqual(["src/removed.ts:system"]);
		expect(diff.changed).toEqual(["AGENTS.md:repository"]);
	});
});
