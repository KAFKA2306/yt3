import { describe, expect, test } from "bun:test";
import path from "node:path";
import fs from "fs-extra";
import { YOUTUBE_PROFILES } from "../src/domain/youtube_profiles.js";

describe("dbt channel_profiles seed synchronization", () => {
	test("matches YOUTUBE_PROFILES canonical ids, buckets, titles, and handles", () => {
		const csvPath = path.join(
			process.cwd(),
			"analytics",
			"seeds",
			"channel_profiles.csv",
		);
		const lines = fs
			.readFileSync(csvPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => line.split(","));
		const [header, ...rows] = lines;
		expect(header).toEqual([
			"profile",
			"bucket",
			"channel_id",
			"channel_title",
			"channel_handle",
			"target_weekly_uploads",
			"ypp_target_subscribers",
			"ypp_target_watch_hours",
		]);
		const byProfile = new Map(rows.map((row) => [row[0], row]));
		for (const profile of Object.values(YOUTUBE_PROFILES)) {
			const row = byProfile.get(profile.profileName);
			expect(row).toBeDefined();
			expect(row?.[1]).toBe(profile.bucket);
			expect(row?.[2]).toBe(profile.expectedChannelId);
			expect(row?.[3]).toBe(profile.expectedChannelTitle);
			expect(row?.[4]).toBe(profile.expectedChannelHandle);
		}
		expect(rows).toHaveLength(Object.keys(YOUTUBE_PROFILES).length);
	});
});
