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
	test("returns the first valid value without retrying", () =>
		withLogPath(async (logPath) => {
			const { exec, prompts } = scriptedExec([
				'{"hookPromises":["一つ目","二つ目"]}',
			]);
			const result = await invokeCodexStructured({
				llm,
				logPath,
				schema,
				name: "first_pass",
				messages,
				exec,
			});
			expect(result).toEqual({ hookPromises: ["一つ目", "二つ目"] });
			expect(prompts).toHaveLength(1);
			expect(readLog(logPath)).toEqual([
				expect.objectContaining({
					event: "validation",
					stage: "first_pass",
					attempt: 1,
					status: "PASS",
					validationErrors: [],
				}),
			]);
		}));

	test("feeds every violated Zod path back into the next attempt", () =>
		withLogPath(async (logPath) => {
			const feedbacks: Array<string | undefined> = [];
			const { exec } = scriptedExec([
				`{"hookPromises":["${"あ".repeat(25)}","い"]}`,
				'{"hookPromises":["う","え"]}',
			]);
			const result = await invokeCodexStructured({
				llm,
				logPath,
				schema,
				name: "zod_feedback",
				messages: (_attempt, lastValidationError) => {
					feedbacks.push(lastValidationError);
					return messages();
				},
				exec,
			});
			expect(result).toEqual({ hookPromises: ["う", "え"] });
			expect(feedbacks[0]).toBeUndefined();
			expect(feedbacks[1]).toContain("hookPromises[0]");
			expect(feedbacks[1]).toContain("24文字以内");
			const failed = readLog(logPath)[0];
			expect(failed).toEqual(
				expect.objectContaining({
					status: "FAIL",
					attempt: 1,
					validationErrors: [expect.stringContaining("hookPromises[0]")],
				}),
			);
		}));

	test("treats unparseable output as a validation failure and retries", () =>
		withLogPath(async (logPath) => {
			const { exec, prompts } = scriptedExec([
				"説明文だけで JSON がありません",
				'{"hookPromises":["一つ目","二つ目"]}',
			]);
			const result = await invokeCodexStructured({
				llm,
				logPath,
				schema,
				name: "parse_retry",
				messages,
				exec,
			});
			expect(result.hookPromises).toHaveLength(2);
			expect(prompts).toHaveLength(2);
		}));

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

	test("feeds validate failures back as the next attempt's feedback", () =>
		withLogPath(async (logPath) => {
			const feedbacks: Array<string | undefined> = [];
			const { exec } = scriptedExec([
				'{"hookPromises":["一つ目","二つ目"]}',
				'{"hookPromises":["三つ目","四つ目"]}',
			]);
			const result = await invokeCodexStructured({
				llm,
				logPath,
				schema,
				name: "validate_feedback",
				messages: (_attempt, lastValidationError) => {
					feedbacks.push(lastValidationError);
					return messages();
				},
				validate: (value) => {
					if (value.hookPromises[0] === "一つ目") {
						throw new Error("CONTRACT_MISMATCH: 一つ目");
					}
					return value.hookPromises.length;
				},
				exec,
			});
			expect(result).toBe(2);
			expect(feedbacks[1]).toBe("CONTRACT_MISMATCH: 一つ目");
		}));

	test("sends the json-only instruction with every prompt", () =>
		withLogPath(async (logPath) => {
			const { exec, prompts } = scriptedExec([
				'{"hookPromises":["一つ目","二つ目"]}',
			]);
			await invokeCodexStructured({
				llm,
				logPath,
				schema,
				name: "prompt",
				messages,
				exec,
			});
			expect(prompts[0]).toContain("[SYSTEM]\nsystem prompt");
			expect(prompts[0]).toContain("[USER]\nuser prompt");
			expect(prompts[0].endsWith(llm.json_only_instruction)).toBe(true);
		}));

	test("writes structured attempt evidence in the shared schema version", () =>
		withLogPath(async (logPath) => {
			const evidencePath = path.join(path.dirname(logPath), "attempts.json");
			const { exec } = scriptedExec([
				'{"hookPromises":[]}',
				'{"hookPromises":["一つ目","二つ目"]}',
			]);
			await invokeCodexStructured({
				llm,
				logPath,
				schema,
				name: "evidence",
				messages,
				evidencePath,
				exec,
			});
			const evidence = fs.readJsonSync(evidencePath);
			expect(evidence.schemaVersion).toBe("structured_llm_attempts_v1");
			expect(
				evidence.attempts.map((attempt: { status: string }) => attempt.status),
			).toEqual(["FAIL", "PASS"]);
		}));
});

describe("research structured request keeps the Gemini contract", () => {
	test("maps the shared request onto the unchanged Gemini JSON-text call", () => {
		const request: ResearchStructuredRequest = {
			schema: ResearchPayloadSchema,
			name: "byosan_research_selected_topics",
			maxAttempts: 5,
			evidencePath: "/runs/x/research/structured_attempts_initial.json",
			rawResponseDir: "/runs/x/research/raw_responses/initial",
			messages,
		};
		const params = geminiResearchParams(
			request,
			{ temperature: 0.5 },
			"/runs/x",
		);
		expect(params.responseFormat).toBe("json_text");
		expect(params.llmOptions).toEqual({
			temperature: 0.5,
			sessionId: "/runs/x",
		});
		expect(params.schema).toBe(ResearchPayloadSchema);
		expect(params.name).toBe("byosan_research_selected_topics");
		expect(params.maxAttempts).toBe(5);
		expect(params.evidencePath).toBe(request.evidencePath);
		expect(params.rawResponseDir).toBe(request.rawResponseDir);
		expect(params.messages).toBe(messages);
	});
});
