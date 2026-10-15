import { describe, expect, test } from "bun:test";
import {
	type ResearchPayload,
	ResearchPayloadSchema,
} from "../src/domain/agents/research.js";
import { type createLlm, invokeStructuredLlm } from "../src/io/core.js";

const selectedTopic = {
	category: "マクロ経済",
	selected_topic: "利上げと住宅ローン",
	reason: "金利の家計への波及",
	angle: "金利上昇の家計負担",
	search_query: "住宅ローン 金利 2026",
};

const payloadWithoutResults = { selected_topics: [selectedTopic] };

const payloadWithResults = {
	selected_topics: [
		{
			...selectedTopic,
			results: [
				{
					angle: "金利上昇の家計負担",
					title_hook: "住宅ローン返済は本当に増えたのか",
					key_questions: ["返済額はどれだけ増えたか"],
					news: [],
				},
			],
		},
	],
};

function textFactory(
	texts: string[],
	calls: { structured: number },
): typeof createLlm {
	let index = 0;
	return (() => {
		const content = texts[index];
		index++;
		return {
			keyName: `TEST_RESEARCH_KEY_${index}`,
			invoke: async () => ({ content }),
			withStructuredOutput: () => {
				calls.structured++;
				throw new Error("research must not use the provider response schema");
			},
		};
	}) as unknown as typeof createLlm;
}

describe("byosan research contract", () => {
	test("a text payload without results is retried with the validation error fed back", async () => {
		const feedback: Array<string | undefined> = [];
		const calls = { structured: 0 };
		const result: ResearchPayload = await invokeStructuredLlm({
			schema: ResearchPayloadSchema,
			name: "byosan_research_selected_topics",
			responseFormat: "json_text",
			llmFactory: textFactory(
				[
					JSON.stringify(payloadWithoutResults),
					JSON.stringify(payloadWithResults),
				],
				calls,
			),
			sleep: async () => {},
			messages: (_attempt, lastValidationError) => {
				feedback.push(lastValidationError);
				return [{ role: "user", content: "prompt" }];
			},
		});
		expect(calls.structured).toBe(0);
		expect(feedback[0]).toBeUndefined();
		expect(feedback[1]).toContain("results");
		expect(result.selected_topics[0]?.results).toHaveLength(1);
	});

	test("a payload that never includes results fails after the attempt budget", async () => {
		const calls = { structured: 0 };
		await expect(
			invokeStructuredLlm({
				schema: ResearchPayloadSchema,
				name: "byosan_research_selected_topics",
				responseFormat: "json_text",
				maxAttempts: 2,
				llmFactory: textFactory(
					[
						JSON.stringify(payloadWithoutResults),
						JSON.stringify(payloadWithoutResults),
					],
					calls,
				),
				sleep: async () => {},
				messages: () => [{ role: "user", content: "prompt" }],
			}),
		).rejects.toThrow("STRUCTURED_OUTPUT_VALIDATION_EXHAUSTED");
	});
});
