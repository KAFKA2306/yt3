import { describe, expect, it } from "bun:test";
import {
	AGY_CREATIVE_MODEL,
	AGY_JUDGE_MODEL,
	buildAgyStreamInput,
	parseAgyStreamResult,
} from "../src/io/agy.js";

describe("agy stream-json transport", () => {
	it("builds a single-line NDJSON user event even for prompts exceeding Linux argv limits", () => {
		const hugePrompt = "A".repeat(250_000);
		const payload = buildAgyStreamInput(hugePrompt);
		expect(payload.endsWith("\n")).toBe(true);
		const lines = payload.trimEnd().split("\n");
		expect(lines.length).toBe(1);
		const parsed = JSON.parse(lines[0] ?? "") as {
			event: string;
			message: { content: string };
		};
		expect(parsed.event).toBe("user");
		expect(parsed.message.content.length).toBe(250_000);
	});

	it("parses the terminal result event from NDJSON stream output", () => {
		const ndjson = [
			JSON.stringify({ event: "init", conversation_id: "c1" }),
			JSON.stringify({
				event: "step_update",
				step_update: { step_index: 0, state: "DONE" },
			}),
			JSON.stringify({
				event: "result",
				result: {
					conversation_id: "c1",
					status: "SUCCESS",
					response: '{"ok":true}',
					structured_output: { ok: true },
					usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
				},
			}),
		].join("\n");
		const env = parseAgyStreamResult(ndjson);
		expect(env.status).toBe("SUCCESS");
		expect(env.conversation_id).toBe("c1");
		expect(env.structured_output).toEqual({ ok: true });
	});

	it("throws when no terminal result event is present", () => {
		expect(() =>
			parseAgyStreamResult(JSON.stringify({ event: "init" })),
		).toThrow(/terminal result event/);
	});

	it("keeps creative author model and independent judge model distinct", () => {
		expect(AGY_CREATIVE_MODEL).toBe("gemini-4-neon-high");
		expect(AGY_JUDGE_MODEL).not.toBe(AGY_CREATIVE_MODEL);
	});
});
