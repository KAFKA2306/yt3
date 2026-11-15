import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import {
	loadPublicationState,
	transitionPublication,
	tryReuseCanonicalPublication,
} from "../src/domain/publication_state.js";
import type { YouTubeProfile } from "../src/domain/youtube_profiles.js";

function tempRun(name: string): string {
	const dir = path.join(
		process.cwd(),
		".tmp-publication-tests",
		`${name}-${randomUUID()}`,
	);
	fs.ensureDirSync(dir);
	return dir;
}

describe("canonical publication state", () => {
	test("persists one canonical state and preserves remote identity", () => {
		const runDir = tempRun("state");
		try {
			const hash = "a".repeat(64);
			transitionPublication(runDir, {
				run_id: "byosan_money/test",
				artifact_sha256: hash,
				requested_visibility: "public",
				phase: "PRIVATE_UPLOAD_INTENT",
			});
			transitionPublication(runDir, {
				run_id: "byosan_money/test",
				artifact_sha256: hash,
				requested_visibility: "public",
				phase: "REMOTE_VERIFIED",
				video_id: "video-1",
				channel_id: "channel-1",
				channel_title: "Channel",
				observed_visibility: "private",
			});
			const state = loadPublicationState(runDir);
			expect(state?.phase).toBe("REMOTE_VERIFIED");
			expect(state?.video_id).toBe("video-1");
			expect(state?.artifact_sha256).toBe(hash);
		} finally {
			fs.removeSync(runDir);
		}
	});

	test("reuses a matching remote video by read-back instead of creating a second upload", async () => {
		const runDir = tempRun("reuse");
		try {
			const hash = "b".repeat(64);
			transitionPublication(runDir, {
				run_id: "byosan_money/test",
				artifact_sha256: hash,
				requested_visibility: "public",
				phase: "REMOTE_VERIFIED",
				video_id: "video-1",
				channel_id: "channel-1",
				channel_title: "Channel",
				observed_visibility: "private",
			});
			let listCalls = 0;
			const fakeYoutube = {
				videos: {
					list: async () => {
						listCalls += 1;
						return {
							data: {
								items: [
									{
										snippet: {
											channelId: "channel-1",
											channelTitle: "Channel",
											publishedAt: "2026-08-20T00:00:00Z",
										},
										status: { privacyStatus: "private" },
									},
								],
							},
						};
					},
				},
			} as unknown as Parameters<typeof tryReuseCanonicalPublication>[0];
			const profile = {
				expectedChannelId: "channel-1",
				expectedChannelTitle: "Channel",
			} as YouTubeProfile;
			const reuse = await tryReuseCanonicalPublication(
				fakeYoutube,
				runDir,
				hash,
				profile,
			);
			expect(listCalls).toBe(1);
			expect(reuse?.result.video_id).toBe("video-1");
			expect(reuse?.state.phase).toBe("REMOTE_VERIFIED");
		} finally {
			fs.removeSync(runDir);
		}
	});
});
