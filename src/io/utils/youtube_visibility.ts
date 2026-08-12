import { google } from "googleapis";

export type YouTubeVisibilityAttestation = {
	video_id: string;
	channel_id?: string;
	channel_title?: string;
	title?: string;
	current_privacy_status: string;
	target_privacy_status: string;
	updated: boolean;
	verified_at: string;
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureYouTubeVideoVisibility(
	auth: InstanceType<typeof google.auth.OAuth2>,
	videoId: string,
	targetPrivacyStatus: string,
): Promise<YouTubeVisibilityAttestation> {
	const youtube = google.youtube({ version: "v3", auth });
	const lookup = async () =>
		youtube.videos.list({
			part: ["status", "snippet"],
			id: [videoId],
		});

	const attempts = 6;
	let updated = false;
	let lastMessage = `Video not found on YouTube: ${videoId}`;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const initial = await lookup();
		const item = initial.data.items?.[0];
		if (!item) {
			lastMessage = `Video not found on YouTube: ${videoId} (attempt ${attempt}/${attempts})`;
			if (attempt < attempts) {
				await sleep(5000 * attempt);
				continue;
			}
			break;
		}

		const currentPrivacy = item.status?.privacyStatus || "unknown";
		if (currentPrivacy !== targetPrivacyStatus) {
			await youtube.videos.update({
				part: ["status"],
				requestBody: {
					id: videoId,
					status: { privacyStatus: targetPrivacyStatus },
				},
			});
			updated = true;
		}

		const verified = await lookup();
		const verifiedItem = verified.data.items?.[0];
		if (!verifiedItem) {
			lastMessage = `Video disappeared while verifying visibility: ${videoId} (attempt ${attempt}/${attempts})`;
			if (attempt < attempts) {
				await sleep(5000 * attempt);
				continue;
			}
			break;
		}

		const verifiedPrivacy = verifiedItem.status?.privacyStatus || "unknown";
		if (verifiedPrivacy !== targetPrivacyStatus) {
			lastMessage = `Unable to verify desired visibility for ${videoId}: expected ${targetPrivacyStatus} but got ${verifiedPrivacy}`;
			if (attempt < attempts) {
				await sleep(5000 * attempt);
				continue;
			}
			break;
		}

		return {
			video_id: videoId,
			channel_id: verifiedItem.snippet?.channelId ?? undefined,
			channel_title: verifiedItem.snippet?.channelTitle ?? undefined,
			title: verifiedItem.snippet?.title ?? undefined,
			current_privacy_status: verifiedPrivacy,
			target_privacy_status: targetPrivacyStatus,
			updated,
			verified_at: new Date().toISOString(),
		};
	}

	throw new Error(
		`PENDING: visibility verification did not complete for ${videoId}. Last error: ${lastMessage}`,
	);
}
