import { describe, expect, test } from "bun:test";
import { buildYouTubeStatus } from "../src/domain/dancer_publication.js";
import type { AgentState } from "../src/domain/types.js";

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

describe("analytics windows", () => {});
