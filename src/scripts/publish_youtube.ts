import { spawn } from "node:child_process";
import path from "node:path";
import dotenv from "dotenv";
import { google } from "googleapis";
import {
	assertProfileEnvFile,
	assertYouTubeChannelMatchesProfile,
	getYouTubeProfile,
	hydrateOAuthCredentials,
} from "../domain/youtube_profiles.js";

const envFile = process.env.ENV_FILE?.trim();
if (!envFile) {
	throw new Error("ENV_FILE is required for YouTube publish");
}

const envFilePath = path.isAbsolute(envFile)
	? envFile
	: path.join(process.cwd(), envFile);

dotenv.config({ path: envFilePath, override: true });

async function main() {
	const profile = getYouTubeProfile();
	assertProfileEnvFile(profile, process.env.ENV_FILE);

	const runId = process.env.RUN_ID || process.argv[2];
	if (!runId) {
		throw new Error(
			`RUN_ID is required for publish profile '${profile.profileName}'`,
		);
	}

	const clientId = process.env.YOUTUBE_CLIENT_ID;
	const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error(
			`YouTube publish failed for profile '${profile.profileName}': YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET are required`,
		);
	}

	const redirectUri =
		process.env.YOUTUBE_REDIRECT_URI || "http://localhost:3310/oauth2callback";
	const auth = new google.auth.OAuth2({
		clientId,
		clientSecret,
		redirectUri,
	});

	await hydrateOAuthCredentials(auth, profile);
	const result = await assertYouTubeChannelMatchesProfile(auth, profile);
	console.log("CHANNEL:");
	console.log(result.actual.title);
	console.log(result.actual.handle ?? "");

	await new Promise<void>((resolve, reject) => {
		const child = spawn(
			"bun",
			[`--env-file=${envFile}`, "src/step.ts", "publish", runId],
			{
				cwd: process.cwd(),
				env: process.env,
				stdio: "inherit",
			},
		);

		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(
					new Error(`Publish step failed with exit code ${code ?? "null"}`),
				);
			}
		});
	});
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
