import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import { z } from "zod";
import {
	type LlmOptions,
	type createLlm,
	invokeStructuredLlm,
} from "../src/io/core.js";

type FakeOutcome =
	| { kind: "error"; error: Error }
	| { kind: "value"; value: unknown };

function fakeFactory(outcomes: FakeOutcome[], names: string[]): typeof createLlm {
	let index = 0;
	return ((_: LlmOptions = {}) => {
		const current = outcomes[index];
		const keyName = names[index] ?? `key_${index + 1}`;
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
	test("rotates after rate limit and succeeds on the next key", async () => {
		const result = await invokeStructuredLlm({
			schema: z.object({ ok: z.boolean() }),
			name: "rotation_test",
			llmFactory: fakeFactory(
				[
					{ kind: "error", error: new Error("429 quota exceeded") },
					{ kind: "value", value: { ok: true } },
				],
				["GEMINI_API_KEY", "GEMINI_API_KEY_2"],
			),
			sleep: async () => {},
			messages: () => [{ role: "user", content: "test" }],
		});
		expect(result).toEqual({ ok: true });
	});

	test("retries semantic validation without treating it as provider success", async () => {
			let validations = 0;
			const result = await invokeStructuredLlm({
				schema: z.object({ value: z.number() }),
				name: "semantic_test",
				llmFactory: fakeFactory(
					[
						{ kind: "value", value: { value: 1 } },
						{ kind: "value", value: { value: 2 } },
					],
					["GEMINI_API_KEY", "GEMINI_API_KEY"],
				),
				sleep: async () => {},
				messages: () => [{ role: "user", content: "test" }],
				validate: (value) => {
					validations++;
					if (validations === 1) throw new Error("domain audit mismatch");
					return value;
				},
			});
			expect(result.value).toBe(2);
			expect(validations).toBe(2);
	});

	test("non-retryable provider errors stop immediately", async () => {
		let factoryCalls = 0;
		const factory = ((_: LlmOptions = {}) => {
			factoryCalls++;
			return fakeFactory(
				[{ kind: "error", error: new Error("permission denied") }],
				["GEMINI_API_KEY"],
			)();
		}) as unknown as typeof createLlm;
		await expect(
			invokeStructuredLlm({
				schema: z.object({ ok: z.boolean() }),
				name: "fatal_test",
				llmFactory: factory,
				sleep: async () => {},
				messages: () => [{ role: "user", content: "test" }],
			}),
		).rejects.toThrow("permission denied");
		expect(factoryCalls).toBe(1);
	});

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
						["GEMINI_API_KEY"],
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
});
