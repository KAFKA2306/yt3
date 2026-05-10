import * as readline from "node:readline";
import { config } from "dotenv";
import { google } from "googleapis";

async function main() {
	const envFile = process.env.ENV_FILE || "config/.env";
	config({ path: envFile });

	const clientId = process.env.YOUTUBE_CLIENT_ID;
	const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
	const redirectUri =
		process.env.YOUTUBE_REDIRECT_URI || "http://localhost:3000/oauth2callback";

	if (!clientId || !clientSecret) {
		console.error(
			"YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET are required in environment.",
		);
		process.exit(1);
	}

	const oauth2Client = new google.auth.OAuth2(
		clientId,
		clientSecret,
		redirectUri,
	);

	const scopes = [
		"https://www.googleapis.com/auth/youtube.upload",
		"https://www.googleapis.com/auth/youtube.readonly",
	];

	const authUrl = oauth2Client.generateAuthUrl({
		access_type: "offline",
		scope: scopes,
		prompt: "consent",
	});

	console.log("Authorize this app by visiting this url:");
	console.log(authUrl);

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	rl.question("Enter the code from that page here: ", async (code) => {
		rl.close();
		try {
			const { tokens } = await oauth2Client.getToken(code);
			console.log("\nSuccessfully obtained tokens!");
			console.log(`Add this to your ${envFile} file:\n`);
			console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`);

			oauth2Client.setCredentials(tokens);
			const youtube = google.youtube({ version: "v3", auth: oauth2Client });
			const res = await youtube.channels.list({
				part: ["snippet", "id"],
				mine: true,
			});
			const channel = res.data.items?.[0];
			if (channel) {
				console.log("\n--- CHANNEL PREFLIGHT ---");
				console.log(`Channel Title: ${channel.snippet?.title}`);
				console.log(`Channel ID: ${channel.id}`);
				console.log("-------------------------\n");
				console.log("Recommended settings for config/.env.yawa:");
				console.log(`YOUTUBE_EXPECTED_CHANNEL_TITLE=${channel.snippet?.title}`);
				console.log(`YOUTUBE_EXPECTED_CHANNEL_ID=${channel.id}`);
			}
		} catch (err) {
			console.error("Error retrieving access token", err);
		}
	});
}

main().catch(console.error);
