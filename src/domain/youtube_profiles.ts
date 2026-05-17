import path from "node:path";
import fs from "fs-extra";
import { google } from "googleapis";

export type YouTubeProfileName = "byosan" | "yawa" | "humanity";

export type YouTubeProfile = {
	profileName: YouTubeProfileName;
	bucket: string;
	envFile: string;
	expectedChannelTitle: string;
	expectedChannelHandle: string | null;
	tokenPath: string;
};

export const YOUTUBE_PROFILES: Record<YouTubeProfileName, YouTubeProfile> = {
	byosan: {
		profileName: "byosan",
		bucket: "daily_pulse",
		envFile: "config/.env.byosan",
		expectedChannelTitle: "秒算マネー",
		expectedChannelHandle: null,
		tokenPath: "config/.cache/youtube/byosan.json",
	},
	yawa: {
		profileName: "yawa",
		bucket: "yawa_archive",
		envFile: "config/.env.yawa",
		expectedChannelTitle: "夜話アーカイブ ASMR",
		expectedChannelHandle: null,
		tokenPath: "config/.cache/youtube/yawa.json",
	},
	humanity: {
		profileName: "humanity",
		bucket: "humanity_observatory",
		envFile: "config/.env",
		expectedChannelTitle: "雨晴はうの人類観測所",
		expectedChannelHandle: "@humanity_observatory",
		tokenPath: "config/.cache/youtube/humanity.json",
	},
};

export type YouTubeChannelIdentity = {
	channelId: string;
	title: string;
	handle: string | null;
};

export function getYouTubeProfile(
	profileName = process.env.YOUTUBE_CHANNEL_PROFILE,
): YouTubeProfile {
	if (!profileName) {
		throw new Error(
			"YOUTUBE_CHANNEL_PROFILE is required. Use byosan, yawa, or humanity.",
		);
	}

	// Support backwards compatibility for legacy profile names
	let normalizedName = profileName.trim();
	if (normalizedName === "byosan_money") normalizedName = "byosan";
	if (normalizedName === "yawa_archive_asmr") normalizedName = "yawa";
	if (normalizedName === "humanity_observatory") normalizedName = "humanity";

	const profile =
		YOUTUBE_PROFILES[normalizedName as YouTubeProfileName] ?? null;
	if (!profile) {
		throw new Error(
			`Unknown YOUTUBE_CHANNEL_PROFILE '${profileName}'. Expected one of: ${Object.keys(
				YOUTUBE_PROFILES,
			).join(", ")}`,
		);
	}

	return profile;
}

export function assertProfileEnvFile(
	profile: YouTubeProfile,
	envFile?: string,
) {
	if (!envFile) {
		throw new Error(
			`ENV_FILE is required for profile '${profile.profileName}'. Expected ${profile.envFile}.`,
		);
	}

	const normalizedEnvFile = path.normalize(envFile);
	const normalizedExpected = path.normalize(profile.envFile);
	if (normalizedEnvFile !== normalizedExpected) {
		throw new Error(
			`ENV_FILE/profile mismatch: profile='${profile.profileName}', expected_env_file='${profile.envFile}', actual_env_file='${envFile}'`,
		);
	}
}

export function normalizeChannelHandle(handle?: string | null): string | null {
	if (!handle) return null;
	const trimmed = handle.trim();
	if (!trimmed) return null;
	return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

export function resolveYouTubeRedirectUri(): string {
	return (
		process.env.YOUTUBE_REDIRECT_URI || "http://localhost:3310/oauth2callback"
	);
}

export function resolveTokenPath(profile: YouTubeProfile): string {
	return path.resolve(process.cwd(), profile.tokenPath);
}

export async function hydrateOAuthCredentials(
	auth: InstanceType<typeof google.auth.OAuth2>,
	profile: YouTubeProfile,
) {
	const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
	if (refreshToken) {
		auth.setCredentials({ refresh_token: refreshToken });
		return;
	}

	const tokenPath = resolveTokenPath(profile);
	if (await fs.pathExists(tokenPath)) {
		const saved = await fs.readJson(tokenPath);
		if (saved && typeof saved === "object") {
			auth.setCredentials(saved);
			return;
		}
	}

	throw new Error(
		`YouTube credentials missing for profile '${profile.profileName}'. Set YOUTUBE_REFRESH_TOKEN or create ${profile.tokenPath}.`,
	);
}

export async function fetchCurrentChannelIdentity(
	auth: InstanceType<typeof google.auth.OAuth2>,
): Promise<YouTubeChannelIdentity> {
	const youtube = google.youtube({ version: "v3", auth });
	const response = await youtube.channels.list({
		mine: true,
		part: ["snippet"],
		maxResults: 1,
	});

	const channel = response.data.items?.[0];
	if (!channel) {
		throw new Error("Unable to resolve the authenticated YouTube channel");
	}
	const title = channel.snippet?.title ?? null;
	if (!title) {
		throw new Error("YouTube channel title is missing");
	}

	return {
		channelId: channel.id ?? "",
		title,
		handle: normalizeChannelHandle(channel.snippet?.customUrl ?? null),
	};
}

export async function assertYouTubeChannelMatchesProfile(
	auth: InstanceType<typeof google.auth.OAuth2>,
	profile: YouTubeProfile,
) {
	const actual = await fetchCurrentChannelIdentity(auth);
	const expectedHandle = normalizeChannelHandle(profile.expectedChannelHandle);

	if (actual.title !== profile.expectedChannelTitle) {
		throw new Error(
			`Channel mismatch: expected title '${profile.expectedChannelTitle}' but got '${actual.title}'`,
		);
	}

	if (expectedHandle && actual.handle !== expectedHandle) {
		throw new Error(
			`Channel mismatch: expected handle '${expectedHandle}' but got '${actual.handle ?? "null"}'`,
		);
	}

	return { profile, actual };
}
