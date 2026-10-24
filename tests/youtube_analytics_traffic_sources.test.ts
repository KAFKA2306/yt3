import { describe, expect, test } from "bun:test";
import { parseTrafficSourceRows } from "../src/domain/youtube_analytics_traffic_sources.js";

describe("YouTube Analytics traffic-source report", () => {
	test("rejects a non-empty response without required metric headers", () => {
		expect(() =>
			parseTrafficSourceRows(
				[{ name: "insightTrafficSourceType" }],
				[["YT_SEARCH"]],
			),
		).toThrow("Missing required traffic-source report column");
	});
});
