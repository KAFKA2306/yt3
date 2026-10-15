import { describe, expect, test } from "bun:test";
import {
	type ResearchPayload,
	ResearchPayloadSchema,
} from "../src/domain/agents/research.js";
import {
	type createLlm,
	invokeStructuredLlm,
	providerResponseJsonSchema,
} from "../src/io/core.js";

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

function scriptedFactory(values: unknown[]): typeof createLlm {
	let index = 0;
	return (() => {
		const value = values[index];
		index++;
		return {
			keyName: `TEST_RESEARCH_KEY_${index}`,
			withStructuredOutput: () => ({ invoke: async () => value }),
		};
	}) as unknown as typeof createLlm;
}

describe("byosan research structured contract", () => {
	test("the provider response schema requires results on every selected topic", () => {
		const schema = providerResponseJsonSchema(ResearchPayloadSchema) as {
			properties: {
				selected_topics: { items: { required: string[] } };
			};
		};
		expect(schema.properties.selected_topics.items.required).toContain(
			"results",
		);
	});

	test("a payload without results is retried with the validation error fed back", async () => {
		const feedback: Array<string | undefined> = [];
		const result: ResearchPayload = await invokeStructuredLlm({
			schema: ResearchPayloadSchema,
			name: "byosan_research_selected_topics",
			llmFactory: scriptedFactory([payloadWithoutResults, payloadWithResults]),
			sleep: async () => {},
			messages: (_attempt, lastValidationError) => {
				feedback.push(lastValidationError);
				return [{ role: "user", content: "prompt" }];
			},
		});
		expect(feedback[0]).toBeUndefined();
		expect(feedback[1]).toContain("results");
		expect(result.selected_topics[0]?.results).toHaveLength(1);
	});

	test("a payload that never includes results fails after the attempt budget", async () => {
		await expect(
			invokeStructuredLlm({
				schema: ResearchPayloadSchema,
				name: "byosan_research_selected_topics",
				maxAttempts: 2,
				llmFactory: scriptedFactory([
					payloadWithoutResults,
					payloadWithoutResults,
				]),
				sleep: async () => {},
				messages: () => [{ role: "user", content: "prompt" }],
			}),
		).rejects.toThrow("STRUCTURED_OUTPUT_VALIDATION_EXHAUSTED");
	});
});
