import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import {
	ResearchPayloadSchema,
	type ResearchStructuredRequest,
	geminiResearchParams,
} from "../src/domain/agents/research.js";
import {
	type CodexLlmConfig,
	type CodexLogRecord,
	invokeCodexStructured,
} from "../src/domain/byosan/codex_llm.js";

const llm: CodexLlmConfig = {
	sandbox: "read-only",
	workdir_prefix: "byosan-llm-test-",
	max_attempts: 3,
	json_only_instruction: "JSON 値だけを返してください。",
};

const schema = z.object({
	hookPromises: z.array(z.string().min(1).max(24)).min(2),
});

const messages = () => [
	{ role: "system" as const, content: "system prompt" },
	{ role: "user" as const, content: "user prompt" },
];

function scriptedExec(outputs: string[]) {
	const prompts: string[] = [];
	const exec = (prompt: string): string => {
		prompts.push(prompt);
		const output = outputs[prompts.length - 1];
		if (output === undefined) throw new Error("unexpected extra codex call");
		return output;
	};
	return { exec, prompts };
}

function withLogPath<T>(run: (logPath: string) => Promise<T>): Promise<T> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "byosan-codex-log-test-"));
	return run(path.join(dir, "audit", "llm_calls.jsonl")).finally(() =>
		fs.removeSync(dir),
	);
}

function readLog(logPath: string): CodexLogRecord[] {
	return fs
		.readFileSync(logPath, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as CodexLogRecord);
}

describe("codex structured invocation", () => {
	test("stops at the configured max_attempts with an explicit exhaustion error", () =>
		withLogPath(async (logPath) => {
			const { exec, prompts } = scriptedExec([
				'{"hookPromises":[]}',
				'{"hookPromises":[]}',
				'{"hookPromises":[]}',
			]);
			await expect(
				invokeCodexStructured({
					llm,
					logPath,
					schema,
					name: "exhausted",
					messages,
					exec,
				}),
			).rejects.toThrow("STRUCTURED_OUTPUT_VALIDATION_EXHAUSTED: exhausted");
			expect(prompts).toHaveLength(llm.max_attempts);
			expect(readLog(logPath).map((record) => record.status)).toEqual([
				"FAIL",
				"FAIL",
				"FAIL",
			]);
		}));
});

describe("research structured request keeps the Gemini contract", () => {});
