import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	findPublishedByosanRunForDate,
	normalizeFeatureDraft,
} from "../src/scripts/byosan_daily.js";
import type { ByosanAngleCandidate } from "../src/domain/byosan/news_angle.js";

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
});

async function makeRoot(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "byosan-daily-test-"));
	tempRoots.push(root);
	return root;
}

describe("byosan daily duplicate-publication gate", () => {
	test("normalizes model drift before feature schema validation", () => {
		const candidate = {
			angle: "A grounded angle with enough detail",
			numbers: ["47.4", "28.8"],
		} as ByosanAngleCandidate;
		const sources = [
			{ id: "source_a", name: "Source A", url: "https://example.com/a" },
		];
		const draft = normalizeFeatureDraft(
			{
				thumbnail: { accent: "この文字列は長すぎるアクセント" },
				segments: Array.from({ length: 20 }, () => ({
					emotion: "unrecognized-model-label",
				})),
			},
			candidate,
			sources,
		);

		expect((draft.thumbnail as { accent: string }).accent).toHaveLength(10);
		const emotions = (draft.segments as Array<{ emotion: string }>).map(
			(segment) => segment.emotion,
		);
		expect(new Set(emotions).size).toBe(10);

		const aliased = normalizeFeatureDraft(
			{ segments: [{ emotion: "concerned" }] },
			candidate,
			sources,
		);
		expect((aliased.segments as Array<{ emotion: string }>)[0].emotion).toBe(
			"caution",
		);
	});

	test("returns null when the date has no upload receipt", async () => {
		const root = await makeRoot();
		expect(findPublishedByosanRunForDate(root, "2026-08-02")).toBeNull();
	});

	test("blocks duplicate upload when receipt exists but attestations are incomplete", async () => {
		const root = await makeRoot();
		const publishDir = path.join(
			root,
			"runs/byosan_money/2026-08-02-daily/publish",
		);
		await fs.outputJson(path.join(publishDir, "receipt.json"), {
			youtube: {
				status: "uploaded",
				video_id: "video123",
				channel_id: "UCYtjO-PYBfdG3MuPLXfhA-Q",
				privacy_status: "public",
			},
		});
		const result = findPublishedByosanRunForDate(root, "2026-08-02");
		expect(result?.verified).toBe(false);
		expect(result?.reason).toContain("attestation_is_incomplete");
	});

	test("accepts one verified public upload and suppresses another", async () => {
		const root = await makeRoot();
		const publishDir = path.join(
			root,
			"runs/byosan_money/2026-08-02-daily/publish",
		);
		await Promise.all([
			fs.outputJson(path.join(publishDir, "receipt.json"), {
				youtube: {
					status: "uploaded",
					video_id: "video123",
					channel_id: "UCYtjO-PYBfdG3MuPLXfhA-Q",
					privacy_status: "public",
				},
			}),
			fs.outputJson(path.join(publishDir, "visibility_attestation.json"), {
				current_privacy_status: "public",
				channel_id: "UCYtjO-PYBfdG3MuPLXfhA-Q",
			}),
			fs.outputJson(path.join(publishDir, "thumbnail_attestation.json"), {
				api_update_status: "succeeded",
			}),
		]);
		const result = findPublishedByosanRunForDate(root, "2026-08-02");
		expect(result).toMatchObject({
			runId: "byosan_money/2026-08-02-daily",
			verified: true,
			videoId: "video123",
		});
	});
});
