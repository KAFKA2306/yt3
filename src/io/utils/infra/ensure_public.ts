import path from "node:path";
import dotenv from "dotenv";
import fs from "fs-extra";
import { google } from "googleapis";
import { loadConfig } from "../../core.js";
import { ensureYouTubeVideoVisibility } from "../youtube_visibility.js";

const envFilePath = process.env.ENV_FILE
	? path.isAbsolute(process.env.ENV_FILE)
		? process.env.ENV_FILE
		: path.join(process.cwd(), process.env.ENV_FILE)
	: path.join(process.cwd(), "config/.env");
dotenv.config({ path: envFilePath, override: true });

async function main() {
	const config = loadConfig();
	const visibility = config.steps.youtube?.default_visibility;

	if (!visibility) {
		console.error(
			"YouTube visibility update failed: steps.youtube.default_visibility is missing in config/default.yaml",
		);
		process.exit(1);
	}

	if (process.env.YOUTUBE_ALLOW_PUBLICIZE !== "true") {
		console.log(
			"Skipping publicize check because YOUTUBE_ALLOW_PUBLICIZE is not true",
		);
		return;
	}
	const runId = process.env.RUN_ID || "run_20260218_antigravity";
	const publishPath = `runs/${runId}/publish/receipt.json`;
	if (!fs.existsSync(publishPath)) {
		console.error(`Publish receipt not found at ${publishPath}`);
		return;
	}
	const publishData = fs.readJsonSync(publishPath) as {
		youtube?: { video_id?: string };
	};

	const videoId = publishData?.youtube?.video_id;
	if (!videoId) {
		console.error("No video ID found in publish receipt");
		return;
	}
	console.log(`Checking visibility for Video ID: ${videoId}`);
	const auth = new google.auth.OAuth2(
		process.env.YOUTUBE_CLIENT_ID,
		process.env.YOUTUBE_CLIENT_SECRET,
		process.env.YOUTUBE_REDIRECT_URI || "http://localhost:3000/oauth2callback",
	);
	auth.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
	const attestation = await ensureYouTubeVideoVisibility(
		auth,
		videoId,
		visibility,
	);
	console.log(`Current Privacy: ${attestation.current_privacy_status}`);
	if (attestation.updated) {
		console.log(`Successfully updated to ${visibility.toUpperCase()}.`);
	} else {
		console.log(`Video is already ${visibility.toUpperCase()}.`);
	}
	fs.writeJsonSync(
		path.join("runs", runId, "publish", "visibility_attestation.json"),
		attestation,
		{ spaces: 2 },
	);
}
main();
