import { describe, expect, test } from "bun:test";
import { getAnalyticsProfileForBucket } from "../src/domain/youtube_profiles.js";

describe("YouTube Analytics bucket authorization boundary", () => {
	test("keeps all configured YouTube channels eligible", () => {
		expect(getAnalyticsProfileForBucket("byosan_money")?.profileName).toBe(
			"byosan",
		);
		expect(getAnalyticsProfileForBucket("yawa_archive")?.profileName).toBe(
			"yawa",
		);
		expect(
			getAnalyticsProfileForBucket("humanity_observatory")?.profileName,
		).toBe("humanity");
	});

	test("does not require a guessed OAuth profile for pulse_nlm", () => {
		expect(getAnalyticsProfileForBucket("pulse_nlm")).toBeNull();
	});

	test("fails closed for a new unknown bucket", () => {
		expect(() => getAnalyticsProfileForBucket("unrecognized_channel")).toThrow(
			"No YouTube profile configured for bucket 'unrecognized_channel'",
		);
	});
});
