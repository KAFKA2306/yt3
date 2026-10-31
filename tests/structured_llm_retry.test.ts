import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import { z } from "zod";
import {
	type createLlm,
	invokeStructuredLlm,
	type LlmOptions,
} from "../src/io/core.js";

type FakeOutcome =
	| { kind: "error"; error: Error }
	| { kind: "value"; value: unknown };

function fakeFactory(
	outcomes: FakeOutcome[],
	names: string[],
): typeof createLlm {
	let index = 0;
	return ((_: LlmOptions = {}) => {
		const current = outcomes[index];
		const keyName = names[index] ?? `TEST_KEY_${index + 1}`;
		index++;
		return {
			keyName,
			withStructuredOutput: () => ({
				invoke: async () => {
					if (!current) throw new Error("missing fake outcome");
					if (current.kind === "error") throw current.error;
					return current.value;
				},
			}),
		};
	}) as unknown as typeof createLlm;
}

describe("canonical structured LLM invocation", () => {
	test("attempt evidence redacts secret values", async () => {
		const secret = "AIzaSecretSecretSecretSecret123";
		const old = process.env.GEMINI_API_KEY;
		process.env.GEMINI_API_KEY = secret;
		const dir = fs.mkdtempSync("/tmp/yt3-structured-");
		const evidencePath = `${dir}/attempts.json`;
		try {
			await expect(
				invokeStructuredLlm({
					schema: z.object({ ok: z.boolean() }),
					name: "redaction_test",
					evidencePath,
					llmFactory: fakeFactory(
						[
							{
								kind: "error",
								error: new Error(`permission denied ${secret}`),
							},
						],
						["TEST_REDACTION_KEY"],
					),
					sleep: async () => {},
					messages: () => [{ role: "user", content: "test" }],
				}),
			).rejects.toThrow();
			const persisted = fs.readFileSync(evidencePath, "utf8");
			expect(persisted).not.toContain(secret);
			expect(persisted).toContain("[REDACTED_KEY]");
		} finally {
			if (old === undefined) {
				Reflect.deleteProperty(process.env, "GEMINI_API_KEY");
			} else {
				process.env.GEMINI_API_KEY = old;
			}
			fs.removeSync(dir);
		}
	});

	test("key-pool exhaustion cannot fall back to primary and key prefixes are not logged", () => {
		const quotaSource = fs.readFileSync(
			"src/io/utils/quota/manager.ts",
			"utf8",
		);
		const coreSource = fs.readFileSync("src/io/core.ts", "utf8");
		expect(quotaSource).not.toContain("Falling back to primary");
		expect(coreSource).not.toContain("apiKey.slice");
	});

	test("provider response schema drops size limits and keeps required fields and enums", async () => {
		const received: unknown[] = [];
		await invokeStructuredLlm({
			schema: z.object({
				items: z.array(z.string().max(3)).min(1).max(2),
				level: z.number().min(0).max(1),
				code: z.string().regex(/^a+$/),
				kind: z.enum(["a", "b"]),
			}),
			name: "provider_schema_test",
			llmFactory: recordingFactory(
				{ items: ["x"], level: 0.5, code: "aa", kind: "a" },
				received,
			),
			sleep: async () => {},
			messages: () => [{ role: "user", content: "test" }],
		});
		const serialized = JSON.stringify(received[0]);
		expect(serialized).not.toMatch(
			/"(minItems|maxItems|minLength|maxLength|minimum|maximum|pattern)"/,
		);
		expect(serialized).toContain('"required"');
		expect(serialized).toContain('"enum"');
	});

	test("persists every raw structured response per attempt with secrets redacted", async () => {
		const secret = "AIzaRawResponseSecretSecret123";
		const old = process.env.GEMINI_API_KEY;
		process.env.GEMINI_API_KEY = secret;
		const dir = fs.mkdtempSync("/tmp/yt3-structured-raw-");
		const rawResponseDir = `${dir}/raw_responses`;
		try {
			const result = await invokeStructuredLlm({
				schema: z.object({ ok: z.boolean() }),
				name: "raw_response_test",
				rawResponseDir,
				llmFactory: fakeFactory(
					[
						{ kind: "value", value: { ok: "no", note: secret } },
						{ kind: "value", value: { ok: true } },
					],
					["TEST_RAW_KEY_1", "TEST_RAW_KEY_2"],
				),
				sleep: async () => {},
				messages: () => [{ role: "user", content: "test" }],
			});
			expect(result).toEqual({ ok: true });
			const first = fs.readJsonSync(`${rawResponseDir}/attempt-1.json`);
			const second = fs.readJsonSync(`${rawResponseDir}/attempt-2.json`);
			expect(first).toMatchObject({
				schemaVersion: "structured_llm_raw_response_v1",
				name: "raw_response_test",
				attempt: 1,
				keyName: "TEST_RAW_KEY_1",
			});
			expect(first.text).toContain('"ok": "no"');
			expect(first.text).not.toContain(secret);
			expect(first.text).toContain("[REDACTED_KEY]");
			expect(second.text).toContain("true");
		} finally {
			if (old === undefined) {
				Reflect.deleteProperty(process.env, "GEMINI_API_KEY");
			} else {
				process.env.GEMINI_API_KEY = old;
			}
			fs.removeSync(dir);
		}
	});

	test("a final rate-limit failure surfaces as QuotaExhaustionError", async () => {
		await expect(
			invokeStructuredLlm({
				schema: z.object({ ok: z.boolean() }),
				name: "quota_exhaustion_test",
				maxAttempts: 1,
				llmFactory: fakeFactory(
					[{ kind: "error", error: new Error("429 quota exceeded") }],
					["TEST_QUOTA_KEY"],
				),
				sleep: async () => {},
				messages: () => [{ role: "user", content: "test" }],
			}),
		).rejects.toThrow("rate limit/quota exhaustion");
	});

	test("local zod still rejects output that exceeds the limits the provider no longer enforces", async () => {
		await expect(
			invokeStructuredLlm({
				schema: z.object({ items: z.array(z.string()).max(2) }),
				name: "local_zod_bounds_test",
				maxAttempts: 1,
				llmFactory: recordingFactory({ items: ["a", "b", "c"] }, []),
				sleep: async () => {},
				messages: () => [{ role: "user", content: "test" }],
			}),
		).rejects.toThrow("STRUCTURED_OUTPUT_VALIDATION_EXHAUSTED");
	});
});

function recordingFactory(
	value: unknown,
	received: unknown[],
): typeof createLlm {
	return (() => ({
		keyName: "TEST_RECORD_KEY",
		withStructuredOutput: (schema: unknown) => {
			received.push(schema);
			return { invoke: async () => value };
		},
	})) as unknown as typeof createLlm;
}
