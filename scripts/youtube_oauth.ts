import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { google } from "googleapis";

const envFile = process.env.ENV_FILE || "config/.env.yawa";
const envPath = path.isAbsolute(envFile) ? envFile : path.join(process.cwd(), envFile);
dotenv.config({ path: envPath, override: true });

const clientId = process.env.YOUTUBE_CLIENT_ID;
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
const redirectUri = process.env.YOUTUBE_REDIRECT_URI || "http://localhost:3310/oauth2callback";
const expectedTitle = process.env.YOUTUBE_EXPECTED_CHANNEL_TITLE?.trim();

if (!clientId || !clientSecret) {
	throw new Error("Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET");
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

const scopes = [
	"https://www.googleapis.com/auth/youtube",
	"https://www.googleapis.com/auth/youtube.upload",
];

const authUrl = oauth2Client.generateAuthUrl({
	access_type: "offline",
	prompt: "consent",
	scope: scopes,
});

console.log("\nOPEN THIS URL:\n");
console.log(authUrl);
console.log("\n");
console.log(`Using env file: ${envPath}`);

http
	.createServer(async (req, res) => {
		try {
			if (!req.url?.includes("/oauth2callback")) {
				res.end("not found");
				return;
			}

			const url = new URL(req.url, redirectUri);
			const code = url.searchParams.get("code");
			if (!code) {
				res.end("missing code");
				return;
			}

			const { tokens } = await oauth2Client.getToken(code);
			if (!tokens.refresh_token) {
				res.end("missing refresh token");
				return;
			}

			const env = fs.readFileSync(envPath, "utf8");
			const nextEnv = env.includes("YOUTUBE_REFRESH_TOKEN=")
				? env.replace(
						/^YOUTUBE_REFRESH_TOKEN=.*$/m,
						`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`,
					)
				: `${env.trimEnd()}\nYOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
			fs.writeFileSync(envPath, nextEnv);

			oauth2Client.setCredentials(tokens);

			const youtube = google.youtube({ version: "v3", auth: oauth2Client });
			const me = await youtube.channels.list({
				mine: true,
				part: ["id", "snippet"],
			});
			const channel = me.data.items?.[0];

			console.log("\nCHANNEL:");
			console.log(channel?.snippet?.title || "(unknown)");
			console.log(channel?.id || "(unknown)");

			if (expectedTitle && channel?.snippet?.title?.trim() !== expectedTitle) {
				console.error(
					`Channel mismatch: expected "${expectedTitle}" but got "${channel?.snippet?.title || "unknown"}"`,
				);
				res.end("channel mismatch");
				process.exit(2);
			}

			console.log("\nREFRESH TOKEN SAVED\n");
			res.end("OAuth success. You can close this tab.");
			process.exit(0);
		} catch (error) {
			console.error(error);
			res.end("OAuth failed");
			process.exit(1);
		}
	})
	.listen(3310, () => {
		console.log("OAuth callback listening on :3310");
	});
