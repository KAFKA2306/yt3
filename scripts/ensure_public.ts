import path from "node:path";
import dotenv from "dotenv";
import fs from "fs-extra";
import { google } from "googleapis";
import yaml from "js-yaml";
dotenv.config({ path: "config/.env" });
async function main() {
	const runId = process.env.RUN_ID || "run_20260218_antigravity";
	const publishPath = `runs/${runId}/publish/output.yaml`;
	if (!fs.existsSync(publishPath)) {
		console.error(`Publish output not found at ${publishPath}`);
		return;
	}
	const publishData = yaml.load(fs.readFileSync(publishPath, "utf-8")) as any;
	const videoId = publishData.youtube?.video_id;
	if (!videoId) {
		console.error("No video ID found in publish output");
		return;
	}
	console.log(`Checking visibility for Video ID: ${videoId}`);
	const auth = new google.auth.OAuth2(
		process.env.YOUTUBE_CLIENT_ID,
		process.env.YOUTUBE_CLIENT_SECRET,
		process.env.YOUTUBE_REDIRECT_URI || "http:
	);
	auth.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
	const youtube = google.youtube({ version: "v3", auth });
	try {
		const res = await youtube.videos.list({
			part: ["status", "snippet"],
			id: [videoId],
		});
		if (!res.data.items || res.data.items.length === 0) {
			console.error("Video not found on YouTube");
			return;
		}
		const video = res.data.items[0];
		const currentPrivacy = video.status?.privacyStatus;
		const title = video.snippet?.title;
		console.log(`Current Privacy: ${currentPrivacy}`);
		console.log(`Title: ${title}`);
		if (currentPrivacy !== "public") {
			console.log("Updating to PUBLIC...");
			await youtube.videos.update({
				part: ["status"],
				requestBody: {
					id: videoId,
					status: { privacyStatus: "public" },
				},
			});
			console.log("Successfully updated to PUBLIC.");
		} else {
			console.log("Video is already PUBLIC.");
		}
	} catch (error) {
		console.error("Error interacting with YouTube API:", error);
	}
}
main();
