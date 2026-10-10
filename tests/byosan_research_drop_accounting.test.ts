import { describe, expect, test } from "bun:test";
import { settleResearchPayload } from "../src/domain/agents/research.js";

const topicWithResults = (results: Array<Record<string, unknown>>) => ({
	selected_topics: [
		{
			category: "power",
			selected_topic: "利上げと住宅ローン",
			reason: "金利の家計への波及",
			angle: "金利上昇の家計負担",
			search_query: "住宅ローン 金利 2026",
			results: results.map((result) => ({
				angle: "金利上昇の家計負担",
				title_hook: "住宅ローン返済は本当に増えたのか",
				key_questions: ["返済額はどれだけ増えたか"],
				news: [],
				...result,
			})),
		},
	],
});

describe("settleResearchPayload drop accounting", () => {
	test("records a byosan result without byosan_angle as rejected with a reason", () => {
		const settled = settleResearchPayload(
			topicWithResults([{ byosan_angle: undefined }]) as never,
			{ requireByosanAngle: true },
		);
		expect(settled.rejected_byosan_candidates).toEqual([
			{
				topic: "利上げと住宅ローン",
				angle: "金利上昇の家計負担",
				issues: ["byosan_angle: missing from LLM result"],
			},
		]);
	});

	test("does not account for missing byosan_angle outside the byosan bucket", () => {
		const settled = settleResearchPayload(
			topicWithResults([{ byosan_angle: undefined }]) as never,
			{ requireByosanAngle: false },
		);
		expect(settled.rejected_byosan_candidates).toEqual([]);
	});

	test("counts every missing candidate separately", () => {
		const settled = settleResearchPayload(
			topicWithResults([
				{ byosan_angle: undefined },
				{ byosan_angle: undefined, angle: "別の角度" },
			]) as never,
			{ requireByosanAngle: true },
		);
		expect(settled.rejected_byosan_candidates).toHaveLength(2);
		expect(settled.rejected_byosan_candidates[1]?.angle).toBe("別の角度");
	});

	test("does not record anything when a topic has no results", () => {
		const settled = settleResearchPayload(topicWithResults([]) as never, {
			requireByosanAngle: true,
		});
		expect(settled.rejected_byosan_candidates).toEqual([]);
	});
});
