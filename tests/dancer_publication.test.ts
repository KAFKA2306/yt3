import { describe, expect, test } from "bun:test";
import { buildYouTubeStatus } from "../src/domain/dancer_publication.js";
import type { AgentState } from "../src/domain/types.js";
import { eligibleWindows } from "../src/scripts/ingest_youtube_analytics.js";

describe("dancer publication contract", () => {
	test("builds private staging status and preserves synthetic disclosure", () => {
		const state = {
			run_id: "byosan_money/dancer-0123456789abcdef0123",
			bucket: "byosan_money",
			contains_synthetic_media: false,
		} as AgentState & { contains_synthetic_media: boolean };
		expect(buildYouTubeStatus(state)).toEqual({
			privacyStatus: "private",
			selfDeclaredMadeForKids: false,
			containsSyntheticMedia: false,
		});
	});

	test("rejects scheduled publication in the past", () => {
		const state = {
			run_id: "byosan_money/dancer-0123456789abcdef0123",
			bucket: "byosan_money",
			publish_at: "2020-01-01T00:00:00Z",
		} as AgentState & { publish_at: string };
		expect(() => buildYouTubeStatus(state)).toThrow(
			"publish_at must be in the future",
		);
	});
});

describe("analytics windows", () => {
	test("uses calendar windows instead of mislabeling all-time data as 24h", () => {
		const published = "2026-08-01T10:00:00Z";
		const windows = eligibleWindows(
			published,
			new Date("2026-08-10T12:00:00Z"),
		);
		expect(windows).toEqual([
			{
				name: "published_day",
				startDate: "2026-08-01",
				endDate: "2026-08-01",
			},
			{
				name: "first_7d",
				startDate: "2026-08-01",
				endDate: "2026-08-07",
			},
		]);
	});
});
