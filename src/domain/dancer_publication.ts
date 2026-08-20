import path from "node:path";
import fs from "fs-extra";
import { google } from "googleapis";
import type { AgentState, PublishResults } from "./types.js";
import type { YouTubeProfile } from "./youtube_profiles.js";

export type DancerPublicationState = AgentState & {
	caption_path?: string;
	source_manifest_path?: string;
	source_artifact_sha256?: string;
	contains_synthetic_media?: boolean;
	publish_at?: string;
};

type StoredReceipt = PublishResults & { source_artifact_sha256?: string };

export function asDancerPublicationState(state: AgentState): DancerPublicationState {
	return state as DancerPublicationState;
}

export function buildYouTubeStatus(state: AgentState) {
	const dancer = asDancerPublicationState(state);
	const status: {
		privacyStatus: "private";
		selfDeclaredMadeForKids: false;
		containsSyntheticMedia?: boolean;
		publishAt?: string;
	} = {
		privacyStatus: "private",
		selfDeclaredMadeForKids: false,
	};
	if (typeof dancer.contains_synthetic_media === "boolean") {
		status.containsSyntheticMedia = dancer.contains_synthetic_media;
	}
	if (dancer.publish_at) {
		const timestamp = Date.parse(dancer.publish_at);
		if (!Number.isFinite(timestamp)) throw new Error(`Invalid publish_at timestamp: ${dancer.publish_at}`);
		if (timestamp <= Date.now()) throw new Error(`publish_at must be in the future: ${dancer.publish_at}`);
		status.publishAt = new Date(timestamp).toISOString();
	}
	return status;
}

export async function tryReuseVerifiedDancerUpload(
	youtube: ReturnType<typeof google.youtube>,
	state: AgentState,
	runDir: string,
	profile: YouTubeProfile,
): Promise<PublishResults["youtube"] | null> {
	const dancer = asDancerPublicationState(state);
	if (!dancer.source_manifest_path || !dancer.source_artifact_sha256) return null;
	const receiptPath = path.join(runDir, "publish", "receipt.json");
	if (!fs.existsSync(receiptPath)) return null;
	const receipt = fs.readJsonSync(receiptPath) as StoredReceipt;
	if (receipt.source_artifact_sha256 !== dancer.source_artifact_sha256) return null;
	const videoId = receipt.youtube?.video_id;
	if (!videoId) return null;
	const response = await youtube.videos.list({ part: ["snippet", "status"], id: [videoId] });
	const item = response.data.items?.[0];
	if (!item) return null;
	if (item.snippet?.channelId !== profile.expectedChannelId) {
		throw new Error(
			`Stored publish receipt points to the wrong channel: expected ${profile.expectedChannelId}, got ${item.snippet?.channelId || "missing"}`,
		);
	}
	return {
		status: "uploaded",
		video_id: videoId,
		channel_id: item.snippet.channelId,
		channel_title: item.snippet.channelTitle ?? profile.expectedChannelTitle,
		privacy_status: item.status?.privacyStatus ?? "unknown",
		published_at: item.snippet.publishedAt ?? receipt.youtube?.published_at ?? "",
	};
}

export async function uploadAndVerifyCaption(
	youtube: ReturnType<typeof google.youtube>,
	videoId: string,
	captionPath: string,
	runDir: string,
): Promise<void> {
	if (!fs.existsSync(captionPath)) throw new Error(`Caption file does not exist: ${captionPath}`);
	const extension = path.extname(captionPath).toLowerCase();
	if (extension !== ".vtt" && extension !== ".srt") throw new Error(`Unsupported caption format: ${extension}`);
	const response = await youtube.captions.insert({
		part: ["snippet"],
		requestBody: { snippet: { videoId, language: "ja", name: "Japanese" } },
		media: { mimeType: "application/octet-stream", body: fs.createReadStream(captionPath) },
	});
	const captionId = response.data.id;
	if (!captionId) throw new Error("YouTube caption upload response is missing id");
	let finalStatus = response.data.snippet?.status ?? "unknown";
	for (let attempt = 0; attempt < 6 && finalStatus !== "serving"; attempt++) {
		if (finalStatus === "failed") break;
		await new Promise((resolve) => setTimeout(resolve, 3000));
		const lookup = await youtube.captions.list({ part: ["snippet"], videoId, id: [captionId] });
		finalStatus = lookup.data.items?.[0]?.snippet?.status ?? "unknown";
	}
	if (finalStatus !== "serving") throw new Error(`Caption could not be verified as serving: status=${finalStatus}`);
	fs.ensureDirSync(path.join(runDir, "publish"));
	fs.writeJsonSync(
		path.join(runDir, "publish", "caption_attestation.json"),
		{ video_id: videoId, caption_id: captionId, source_path: captionPath, status: finalStatus, verified_at: new Date().toISOString() },
		{ spaces: 2 },
	);
}

export async function verifyScheduledPublish(
	youtube: ReturnType<typeof google.youtube>,
	videoId: string,
	publishAt: string,
	runDir: string,
): Promise<void> {
	const response = await youtube.videos.list({ part: ["status"], id: [videoId] });
	const status = response.data.items?.[0]?.status;
	if (!status) throw new Error(`Unable to verify scheduled video status: ${videoId}`);
	if (status.privacyStatus !== "private") {
		throw new Error(`Scheduled video must remain private before publishAt: got ${status.privacyStatus}`);
	}
	const expected = Date.parse(publishAt);
	const actual = Date.parse(status.publishAt ?? "");
	if (!Number.isFinite(actual) || Math.abs(actual - expected) > 1000) {
		throw new Error(`Scheduled publishAt mismatch: expected ${new Date(expected).toISOString()}, got ${status.publishAt || "missing"}`);
	}
	fs.ensureDirSync(path.join(runDir, "publish"));
	fs.writeJsonSync(
		path.join(runDir, "publish", "schedule_attestation.json"),
		{ video_id: videoId, privacy_status: status.privacyStatus, publish_at: status.publishAt, verified_at: new Date().toISOString() },
		{ spaces: 2 },
	);
}
