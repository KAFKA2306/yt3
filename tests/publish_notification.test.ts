import { describe, expect, test } from "bun:test";
import { notifyPublishEvent } from "../src/domain/agents/publish.js";
import type { AlertType } from "../src/io/utils/discord.js";

type Sent = {
	message: string;
	type: AlertType;
	details: Record<string, unknown>;
};

function recorder(): {
	sent: Sent[];
	send: (
		message: string,
		type: AlertType,
		details: Record<string, unknown>,
	) => Promise<void>;
} {
	const sent: Sent[] = [];
	return {
		sent,
		send: async (message, type, details) => {
			sent.push({ message, type, details });
		},
	};
}

const enabled = { publish_start: true, publish_complete: true };
const notice = { runId: "byosan_money/2026-10-12-daily", title: "テスト動画" };

describe("publish discord notifications", () => {
	test("sends a start notice with publish_start type, title, run id and state", async () => {
		const rec = recorder();
		await notifyPublishEvent(enabled, "start", notice, rec.send);
		expect(rec.sent).toHaveLength(1);
		expect(rec.sent[0]).toEqual({
			message: "Publish started on YouTube",
			type: "publish_start",
			details: {
				title: "テスト動画",
				runId: "byosan_money/2026-10-12-daily",
				state: "PUBLISH_STARTED",
			},
		});
	});

	test("skips the start notice when publish_start is disabled", async () => {
		const rec = recorder();
		await notifyPublishEvent(
			{ ...enabled, publish_start: false },
			"start",
			notice,
			rec.send,
		);
		expect(rec.sent).toHaveLength(0);
	});

	test("sends a complete notice with video url, channel, privacy and PUBLISHED state", async () => {
		const rec = recorder();
		await notifyPublishEvent(
			enabled,
			"complete",
			{
				...notice,
				channelTitle: "秒算マネー",
				videoId: "abc123",
				privacyStatus: "public",
			},
			rec.send,
		);
		expect(rec.sent).toHaveLength(1);
		expect(rec.sent[0]).toEqual({
			message: "✅ **Successfully uploaded** video to 秒算マネー!",
			type: "publish",
			details: {
				title: "テスト動画",
				videoId: "abc123",
				url: "https://www.youtube.com/watch?v=abc123",
				privacy_status: "public",
				runId: "byosan_money/2026-10-12-daily",
				state: "PUBLISHED",
			},
		});
	});

	test("skips the complete notice when publish_complete is disabled", async () => {
		const rec = recorder();
		await notifyPublishEvent(
			{ ...enabled, publish_complete: false },
			"complete",
			{ ...notice, channelTitle: "秒算マネー", videoId: "abc123" },
			rec.send,
		);
		expect(rec.sent).toHaveLength(0);
	});

	test("keeps start and complete notices distinguishable by alert type", async () => {
		const rec = recorder();
		await notifyPublishEvent(enabled, "start", notice, rec.send);
		await notifyPublishEvent(
			enabled,
			"complete",
			{
				...notice,
				channelTitle: "秒算マネー",
				videoId: "abc123",
			},
			rec.send,
		);
		expect(rec.sent.map((entry) => entry.type)).toEqual([
			"publish_start",
			"publish",
		]);
		expect(rec.sent.map((entry) => entry.details.state)).toEqual([
			"PUBLISH_STARTED",
			"PUBLISHED",
		]);
	});
});
