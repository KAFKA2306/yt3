import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
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
	claude: {
		command: "claude",
		model: "claude-haiku-5-5",
		workdir_prefix: "byosan-claude-test-",
		strip_env: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
	},
	fallback_backend: "claude",
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

	test("keeps each attempt's output beside its validation verdict", () =>
		withLogPath(async (logPath) => {
			const outputs = [
				'{"hookPromises":[]}',
				'{"hookPromises":["開幕の問い","結論の数字"]}',
			];
			const { exec } = scriptedExec(outputs);
			await invokeCodexStructured({
				llm,
				logPath,
				schema,
				name: "recorded",
				messages,
				exec,
			});
			expect(
				readLog(logPath)
					.filter((record) => record.event === "validation")
					.map((record) => [record.status, record.output]),
			).toEqual([
				["FAIL", outputs[0]],
				["PASS", outputs[1]],
			]);
		}));

	test("switches to the fallback backend on a usage limit and records it", () =>
		withLogPath(async (logPath) => {
			const backends: string[] = [];
			const exec = (_prompt: string, backend: string): string => {
				backends.push(backend);
				if (backend === "codex") {
					throw new Error(
						"CODEX_EXEC_FAILED ERROR: You've hit your usage limit",
					);
				}
				return '{"hookPromises":["a","b"]}';
			};
			const value = await invokeCodexStructured({
				llm,
				logPath,
				schema,
				name: "fallback",
				messages,
				exec,
			});
			expect(value.hookPromises).toHaveLength(2);
			expect(backends).toEqual(["codex", "claude"]);
			const records = readLog(logPath);
			expect(records.find((r) => r.event === "fallback")).toMatchObject({
				backend: "claude",
				fromBackend: "codex",
			});
			expect(records.at(-1)?.backend).toBe("claude");
		}));

	test("does not switch on a non-limit failure", () =>
		withLogPath(async (logPath) => {
			const exec = (): string => {
				throw new Error("CODEX_EXEC_FAILED boom");
			};
			await expect(
				invokeCodexStructured({
					llm,
					logPath,
					schema,
					name: "x",
					messages,
					exec,
				}),
			).rejects.toThrow("boom");
		}));

	test("parses claude structured_output, strips api keys, fails on is_error", () =>
		withLogPath(async (logPath) => {
			const bin = fs.mkdtempSync(path.join(os.tmpdir(), "byosan-fake-claude-"));
			const script = path.join(bin, "claude");
			const fake = { ...llm, claude: { ...llm.claude, command: script } };
			const envelope = (isError: boolean) =>
				JSON.stringify({
					is_error: isError,
					total_cost_usd: 0.4,
					result: isError ? "usage limit reached" : "ok",
					structured_output: { hookPromises: ["a", "b"] },
				});
			const write = (isError: boolean) =>
				fs.writeFileSync(
					script,
					`#!/bin/sh\ncat >/dev/null\ntest -z "$ANTHROPIC_API_KEY" || exit 9\necho '${envelope(isError)}'\n`,
					{ mode: 0o755 },
				);
			const call = (name: string) =>
				invokeCodexStructured({
					llm: fake,
					logPath,
					schema,
					name,
					backend: "claude",
					messages,
				});
			process.env.ANTHROPIC_API_KEY = "x";
			try {
				write(false);
				expect((await call("claude_ok")).hookPromises).toEqual(["a", "b"]);
				expect(readLog(logPath).some((r) => r.listCostUsd === 0.4)).toBe(true);
				write(true);
				await expect(call("claude_err")).rejects.toThrow(
					"CLAUDE_EXEC_FAILED stage=claude_err status=0  usage limit reached",
				);
			} finally {
				Reflect.deleteProperty(process.env, "ANTHROPIC_API_KEY");
				fs.removeSync(bin);
			}
		}));
});
