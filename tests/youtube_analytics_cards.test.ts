import { describe, expect, test } from "bun:test";
import { parseCardMetricsRow } from "../src/domain/youtube_analytics_cards.js";

describe("YouTube Analytics card metrics", () => {
	test("parses metric values by header and keeps zero distinct from unavailable", () => {
		expect(
			parseCardMetricsRow(
				[
					{ name: "cardTeaserClickRate" },
					{ name: "cardClicks" },
					{ name: "cardImpressions" },
					{ name: "cardClickRate" },
					{ name: "cardTeaserClicks" },
					{ name: "cardTeaserImpressions" },
				],
				[[null, 0, 0, 0, 0, 12]],
			),
		).toEqual({
			card_impressions: 0,
			card_clicks: 0,
			card_click_rate: 0,
			card_teaser_impressions: 12,
			card_teaser_clicks: 0,
			card_teaser_click_rate: null,
		});
	});

	test("represents a successful report with no rows as unavailable metrics", () => {
		expect(parseCardMetricsRow([], undefined)).toEqual({
			card_impressions: null,
			card_clicks: null,
			card_click_rate: null,
			card_teaser_impressions: null,
			card_teaser_clicks: null,
			card_teaser_click_rate: null,
		});
	});

	test("rejects malformed non-empty rows instead of silently shifting values", () => {
		expect(() =>
			parseCardMetricsRow([{ name: "cardImpressions" }], [[1]]),
		).toThrow("Missing required card-metrics report column");
		expect(() =>
			parseCardMetricsRow(
				[
					{ name: "cardImpressions" },
					{ name: "cardClicks" },
					{ name: "cardClickRate" },
					{ name: "cardTeaserImpressions" },
					{ name: "cardTeaserClicks" },
					{ name: "cardTeaserClickRate" },
				],
				[[1, 0, 0, 0, 0, Number.NaN]],
			),
		).toThrow("Invalid cardTeaserClickRate value");
	});
});
