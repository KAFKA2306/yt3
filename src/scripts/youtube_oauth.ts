import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import dotenv from "dotenv";
import fs from "fs-extra";
import { google } from "googleapis";
import {
	assertProfileEnvFile,
	assertYouTubeChannelMatchesProfile,
	getYouTubeProfile,
	hydrateOAuthCredentials,
	resolveTokenPath,
	resolveYouTubeRedirectUri,
} from "../domain/youtube_profiles.js";

const envFilePath = process.env.ENV_FILE
	? path.isAbsolute(process.env.ENV_FILE)
		? process.env.ENV_FILE
		: path.join(process.cwd(), process.env.ENV_FILE)
	: path.join(process.cwd(), "config/.env");

dotenv.config({ path: envFilePath, override: true });

const verifyOnly = process.argv.includes("--verify-only");

async function waitForOAuthCode(redirectUri: string): Promise<string> {
	const url = new URL(redirectUri);
	const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
	const pathname = url.pathname || "/oauth2callback";

	return await new Promise<string>((resolve, reject) => {
		const server = http.createServer((req, res) => {
			try {
				if (!req.url) {
					res.statusCode = 400;
					res.end("Missing callback URL");
					return;
				}

				const callbackUrl = new URL(req.url, `http://127.0.0.1:${port}`);
				if (callbackUrl.pathname !== pathname) {
					res.statusCode = 404;
					res.end("Not Found");
					return;
				}

				const code = callbackUrl.searchParams.get("code");
				const error = callbackUrl.searchParams.get("error");

				if (error) {
					res.statusCode = 400;
					res.end(`OAuth error: ${error}`);
					reject(new Error(`OAuth error: ${error}`));
					server.close();
					return;
				}

				if (!code) {
					res.statusCode = 400;
					res.end("Missing OAuth code");
					reject(new Error("Missing OAuth code"));
					server.close();
					return;
				}

				res.setHeader("Content-Type", "text/html; charset=utf-8");
				res.end(
					"<html><body>Authentication successful. You can close this tab.</body></html>",
				);
				server.close(() => resolve(code));
			} catch (error) {
				reject(error);
				server.close();
			}
		});

		server.on("error", reject);
		server.listen(port, () => {
			console.log(`OAuth callback listening on :${port}`);
		});
	});
}

async function main() {
	const profile = getYouTubeProfile();
	assertProfileEnvFile(profile, process.env.ENV_FILE);

	const clientId = process.env.YOUTUBE_CLIENT_ID;
	const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error(
			`YouTube auth failed for profile '${profile.profileName}': YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET are required`,
		);
	}

	const redirectUri = resolveYouTubeRedirectUri();
	const auth = new google.auth.OAuth2({
		clientId,
		clientSecret,
		redirectUri,
	});

	if (verifyOnly) {
		await hydrateOAuthCredentials(auth, profile);
		const result = await assertYouTubeChannelMatchesProfile(auth, profile);
		console.log("CHANNEL:");
		console.log(result.actual.title);
		console.log(result.actual.channelId);
		console.log(result.actual.handle ?? "");
		return;
	}

	const authUrl = auth.generateAuthUrl({
		access_type: "offline",
		prompt: "consent",
		scope: [
			"https://www.googleapis.com/auth/youtube",
			"https://www.googleapis.com/auth/youtube.upload",
		],
	});

	console.log("\nOPEN THIS URL:\n");
	console.log(authUrl);
	console.log("");

	const code = await waitForOAuthCode(redirectUri);
	const { tokens } = await auth.getToken(code);
	auth.setCredentials(tokens);

	const tokenPath = resolveTokenPath(profile);
	await fs.ensureDir(path.dirname(tokenPath));
	await fs.writeJson(tokenPath, tokens, { spaces: 2 });

	const result = await assertYouTubeChannelMatchesProfile(auth, profile);
	console.log("CHANNEL:");
	console.log(result.actual.title);
	console.log(result.actual.channelId);
	console.log(result.actual.handle ?? "");
	console.log(`Saved token to ${profile.tokenPath}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
