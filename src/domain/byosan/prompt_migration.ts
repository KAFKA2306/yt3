import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const PromptAuthoritySchema = z.enum(["repository", "system", "developer"]);
const PromptProgressPolicySchema = z.enum([
	"required",
	"forbidden",
	"unspecified",
]);
const PromptConfirmationPolicySchema = z.enum([
	"required",
	"bypass_reversible",
	"unspecified",
]);

export const ByosanPromptPolicySignalsSchema = z.object({
	progressUpdates: PromptProgressPolicySchema,
	confirmation: PromptConfirmationPolicySchema,
});

export const ByosanPromptSourceRecordSchema = z.object({
	sourcePath: z.string().min(1),
	authority: PromptAuthoritySchema,
	promptHash: z.string().regex(/^[a-f0-9]{64}$/),
	providerProfileApplicability: z.array(z.string().min(1)).min(1),
	contractVersion: z.string().min(1),
	signals: ByosanPromptPolicySignalsSchema,
});

export const ByosanPromptInventorySchema = z.object({
	schemaVersion: z.literal("byosan_prompt_inventory_v1"),
	modelProfile: z.string().min(1),
	contractVersion: z.string().min(1),
	generatedAt: z.string().datetime(),
	records: z.array(ByosanPromptSourceRecordSchema),
});

export const ByosanPromptMigrationIssueSchema = z.object({
	severity: z.enum(["FAIL", "WARN"]),
	code: z.string().min(1),
	details: z.string().min(1),
});

export const ByosanPromptInventoryDiffSchema = z.object({
	modelProfileChanged: z.boolean(),
	added: z.array(z.string()),
	removed: z.array(z.string()),
	changed: z.array(z.string()),
});

export type ByosanPromptSourceRecord = z.infer<
	typeof ByosanPromptSourceRecordSchema
>;
export type ByosanPromptInventory = z.infer<typeof ByosanPromptInventorySchema>;
export type ByosanPromptMigrationIssue = z.infer<
	typeof ByosanPromptMigrationIssueSchema
>;
export type ByosanPromptInventoryDiff = z.infer<
	typeof ByosanPromptInventoryDiffSchema
>;

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function normalize(text: string): string {
	return text.normalize("NFKC").toLowerCase();
}

function detectProviderTags(text: string): string[] {
	const normalized = normalize(text);
	const tags = [
		["gpt", /\bgpt(?:[-\s]\w+)?/i],
		["gemini", /\bgemini(?:[-\s]\w+)?/i],
		["claude", /\bclaude(?:[-\s]\w+)?/i],
		["astra", /\bastra\b/i],
		["fable", /\bfable(?:[-\s]\w+)?/i],
	] as const;
	return tags.flatMap(([tag, pattern]) =>
		pattern.test(normalized) ? [tag] : [],
	);
}

export function detectByosanPromptPolicySignals(
	text: string,
): z.infer<typeof ByosanPromptPolicySignalsSchema> {
	const normalized = normalize(text);
	const progressNegated =
		/(禁止しない|禁止ではない|do not prohibit|not forbidden)/i.test(normalized);
	const progressForbidden =
		!progressNegated &&
		(/(途中経過|進捗).{0,24}(報告|更新).{0,24}(禁止|しない|不要)/i.test(
			normalized,
		) ||
			/(do not|don't|never|no).{0,24}progress.{0,16}(update|report)/i.test(
				normalized,
			));
	const progressRequired =
		/(途中経過|進捗).{0,24}(報告|更新).{0,24}(必須|行う|入れる|共有)/i.test(
			normalized,
		) ||
		/(progress.{0,16}(update|report).{0,20}(required|must)|keep.{0,20}user.{0,20}updated)/i.test(
			normalized,
		);
	const confirmationRequired =
		/(確認|承認|許可).{0,20}(必須|求める|必要)/i.test(normalized) ||
		/(ask|require).{0,16}(confirmation|approval|permission)/i.test(normalized);
	const confirmationBypass =
		/(取り消し可能|可逆).{0,30}(確認|承認|許可).{0,16}(不要|求めない|なし)/i.test(
			normalized,
		) ||
		/(reversible).{0,30}(without|no).{0,16}(confirmation|approval|permission)/i.test(
			normalized,
		);

	return ByosanPromptPolicySignalsSchema.parse({
		progressUpdates: progressRequired
			? "required"
			: progressForbidden
				? "forbidden"
				: "unspecified",
		confirmation: confirmationBypass
			? "bypass_reversible"
			: confirmationRequired
				? "required"
				: "unspecified",
	});
}

function collectFiles(root: string, relativeDir: string): string[] {
	const absoluteDir = path.join(root, relativeDir);
	if (!fs.existsSync(absoluteDir)) return [];
	const files: string[] = [];
	for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
		const relativePath = path.join(relativeDir, entry.name);
		if (entry.isDirectory()) {
			if (
				["node_modules", ".git", "runs", "logs", "artifacts"].includes(
					entry.name,
				)
			) {
				continue;
			}
			files.push(...collectFiles(root, relativePath));
			continue;
		}
		if (/\.(?:ts|js|mjs|cjs)$/.test(entry.name)) files.push(relativePath);
	}
	return files;
}

function recordForSource(
	sourcePath: string,
	authority: z.infer<typeof PromptAuthoritySchema>,
	text: string,
	contractVersion: string,
): ByosanPromptSourceRecord {
	const providerTags = detectProviderTags(text);
	return ByosanPromptSourceRecordSchema.parse({
		sourcePath,
		authority,
		promptHash: sha256(text),
		providerProfileApplicability:
			providerTags.length > 0 ? providerTags : ["all"],
		contractVersion,
		signals: detectByosanPromptPolicySignals(text),
	});
}

export function discoverByosanPromptInventory(
	root: string,
	modelProfile: string,
	now = new Date(),
	contractVersion = "prompt_migration_v1",
): ByosanPromptInventory {
	const records: ByosanPromptSourceRecord[] = [];
	const agentsPath = path.join(root, "AGENTS.md");
	if (fs.existsSync(agentsPath)) {
		const text = fs.readFileSync(agentsPath, "utf-8");
		records.push(
			recordForSource("AGENTS.md", "repository", text, contractVersion),
		);
	}

	for (const relativePath of collectFiles(root, "src").sort()) {
		const text = fs.readFileSync(path.join(root, relativePath), "utf-8");
		if (/role\s*:\s*["']system["']|systemInstruction/i.test(text)) {
			records.push(
				recordForSource(relativePath, "system", text, contractVersion),
			);
		}
		if (/role\s*:\s*["']developer["']/i.test(text)) {
			records.push(
				recordForSource(relativePath, "developer", text, contractVersion),
			);
		}
	}

	records.sort(
		(left, right) =>
			left.sourcePath.localeCompare(right.sourcePath) ||
			left.authority.localeCompare(right.authority),
	);
	return ByosanPromptInventorySchema.parse({
		schemaVersion: "byosan_prompt_inventory_v1",
		modelProfile,
		contractVersion,
		generatedAt: now.toISOString(),
		records,
	});
}

function recordKey(record: ByosanPromptSourceRecord): string {
	return `${record.sourcePath}:${record.authority}`;
}

export function diffByosanPromptInventories(
	previousInput: ByosanPromptInventory,
	currentInput: ByosanPromptInventory,
): ByosanPromptInventoryDiff {
	const previous = ByosanPromptInventorySchema.parse(previousInput);
	const current = ByosanPromptInventorySchema.parse(currentInput);
	const previousByKey = new Map(
		previous.records.map((record) => [recordKey(record), record]),
	);
	const currentByKey = new Map(
		current.records.map((record) => [recordKey(record), record]),
	);
	const added = [...currentByKey.keys()]
		.filter((key) => !previousByKey.has(key))
		.sort();
	const removed = [...previousByKey.keys()]
		.filter((key) => !currentByKey.has(key))
		.sort();
	const changed = [...currentByKey.entries()]
		.filter(([key, record]) => {
			const previousRecord = previousByKey.get(key);
			return (
				previousRecord !== undefined &&
				(previousRecord.promptHash !== record.promptHash ||
					previousRecord.contractVersion !== record.contractVersion)
			);
		})
		.map(([key]) => key)
		.sort();
	return ByosanPromptInventoryDiffSchema.parse({
		modelProfileChanged: previous.modelProfile !== current.modelProfile,
		added,
		removed,
		changed,
	});
}

function modelProfileMatches(
	modelProfile: string,
	applicability: string[],
): boolean {
	if (applicability.includes("all")) return true;
	const normalized = normalize(modelProfile);
	return applicability.some((tag) => normalized.includes(tag));
}

export function auditByosanPromptInventory(
	inventoryInput: ByosanPromptInventory,
): ByosanPromptMigrationIssue[] {
	const inventory = ByosanPromptInventorySchema.parse(inventoryInput);
	const issues: ByosanPromptMigrationIssue[] = [];

	const progressRequired = inventory.records.filter(
		(record) => record.signals.progressUpdates === "required",
	);
	const progressForbidden = inventory.records.filter(
		(record) => record.signals.progressUpdates === "forbidden",
	);
	if (progressRequired.length > 0 && progressForbidden.length > 0) {
		issues.push({
			severity: "FAIL",
			code: "explicit_policy_conflict:progress_updates",
			details: `required=${progressRequired.map(recordKey).join(",")} forbidden=${progressForbidden.map(recordKey).join(",")}`,
		});
	}

	const repositoryRecords = inventory.records.filter(
		(record) => record.authority === "repository",
	);
	for (const repository of repositoryRecords) {
		for (const local of inventory.records.filter(
			(record) => record.authority !== "repository",
		)) {
			if (
				repository.signals.progressUpdates !== "unspecified" &&
				local.signals.progressUpdates !== "unspecified" &&
				repository.signals.progressUpdates !== local.signals.progressUpdates
			) {
				issues.push({
					severity: "FAIL",
					code: "repository_authority_conflict:progress_updates",
					details: `${recordKey(local)} conflicts with ${recordKey(repository)}`,
				});
			}
			if (
				repository.signals.confirmation !== "unspecified" &&
				local.signals.confirmation !== "unspecified" &&
				repository.signals.confirmation !== local.signals.confirmation
			) {
				issues.push({
					severity: "FAIL",
					code: "repository_authority_conflict:confirmation",
					details: `${recordKey(local)} conflicts with ${recordKey(repository)}`,
				});
			}
		}
	}

	const hashes = new Map<string, string[]>();
	for (const record of inventory.records) {
		const records = hashes.get(record.promptHash) ?? [];
		records.push(recordKey(record));
		hashes.set(record.promptHash, records);
		if (
			record.authority !== "repository" &&
			!modelProfileMatches(
				inventory.modelProfile,
				record.providerProfileApplicability,
			)
		) {
			issues.push({
				severity: "WARN",
				code: "obsolete_model_specific_patch",
				details: `${recordKey(record)} applicability=${record.providerProfileApplicability.join(",")} current=${inventory.modelProfile}`,
			});
		}
	}
	for (const [hash, records] of hashes.entries()) {
		if (records.length > 1) {
			issues.push({
				severity: "WARN",
				code: "duplicate_prompt_hash",
				details: `${hash.slice(0, 12)}:${records.join(",")}`,
			});
		}
	}

	for (const policy of ["progressUpdates", "confirmation"] as const) {
		const bySignal = new Map<string, string[]>();
		for (const record of inventory.records) {
			const signal = record.signals[policy];
			if (signal === "unspecified") continue;
			const sources = bySignal.get(signal) ?? [];
			sources.push(recordKey(record));
			bySignal.set(signal, sources);
		}
		for (const [signal, sources] of bySignal.entries()) {
			if (sources.length > 1) {
				issues.push({
					severity: "WARN",
					code: `semantic_duplicate:${policy}:${signal}`,
					details: sources.join(","),
				});
			}
		}
	}

	return issues.map((issue) => ByosanPromptMigrationIssueSchema.parse(issue));
}

export function auditByosanPromptMigration(
	previousInput: ByosanPromptInventory | null,
	currentInput: ByosanPromptInventory,
): {
	diff: ByosanPromptInventoryDiff | null;
	issues: ByosanPromptMigrationIssue[];
} {
	const current = ByosanPromptInventorySchema.parse(currentInput);
	const issues = auditByosanPromptInventory(current);
	if (!previousInput) return { diff: null, issues };
	const previous = ByosanPromptInventorySchema.parse(previousInput);
	const diff = diffByosanPromptInventories(previous, current);
	if (
		diff.modelProfileChanged &&
		diff.added.length > 0 &&
		diff.removed.length === 0 &&
		diff.changed.length === 0
	) {
		issues.push({
			severity: "WARN",
			code: "addition_only_model_migration",
			details:
				"model/profile changed but migration only added prompt sources; inspect legacy constraints before adding more",
		});
	}
	return {
		diff,
		issues: issues.map((issue) =>
			ByosanPromptMigrationIssueSchema.parse(issue),
		),
	};
}
