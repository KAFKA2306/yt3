import path from "node:path";
import fs from "fs-extra";
import { google } from "googleapis";

export type YouTubeProfileName = "byosan" | "yawa" | "humanity";

export type YouTubeProfileBase = {
	profileName: YouTubeProfileName;
	bucket: string;
	envFile: string;
	tokenPath: string;
};

export type YouTubeProfile = YouTubeProfileBase & {
	expectedChannelTitle: string;
	expectedChannelHandle: string;
	expectedChannelId: string;
};

export const YOUTUBE_PROFILES = {
	byosan: {
		profileName: "byosan",
		bucket: "daily_pulse",
		envFile: "config/.env.byosan",
		tokenPath: "config/.cache/youtube/byosan.json",
		expectedChannelTitle: "秒算マネー",
		expectedChannelHandle: "@byosan-money",
		expectedChannelId: "UCYtjO-PYBfdG3MuPLXfhA-Q",
	},
	yawa: {
		profileName: "yawa",
		bucket: "yawa_archive",
		envFile: "config/.env.yawa",
		tokenPath: "config/.cache/youtube/yawa.json",
		expectedChannelTitle: "夜話アーカイブ ASMR",
		expectedChannelHandle: "@yawa_archive",
		expectedChannelId: "UCtq3BVv6SBCFjtPiDoetizw",
	},
	humanity: {
		profileName: "humanity",
		bucket: "humanity_observatory",
		envFile: "config/.env",
		tokenPath: "config/.cache/youtube/humanity.json",
		expectedChannelTitle: "雨晴はうの人類観測所",
		expectedChannelHandle: "@humanity_observatory",
		expectedChannelId: "UCMDrWHL4Jc6gtmfoqaW7sxg",
	},
} as const satisfies Record<YouTubeProfileName, YouTubeProfile>;

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

	const normalizedName = profileName.trim() as YouTubeProfileName;
	const profile = YOUTUBE_PROFILES[normalizedName] ?? null;
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
	if (!channel.id) {
		throw new Error("YouTube channel ID is missing");
	}
	const title = channel.snippet?.title ?? null;
	if (!title) {
		throw new Error("YouTube channel title is missing");
	}

	return {
		channelId: channel.id,
		title,
		handle: normalizeChannelHandle(channel.snippet?.customUrl ?? null),
	};
}

export async function assertYouTubeChannelMatchesProfile(
	auth: InstanceType<typeof google.auth.OAuth2>,
	profile: YouTubeProfile,
) {
	const actual = await fetchCurrentChannelIdentity(auth);

	if (actual.title !== profile.expectedChannelTitle) {
		console.warn(
			`[WARNING: CHANNEL MISMATCH] Expected title '${profile.expectedChannelTitle}' but got '${actual.title}'`,
		);
	}

	if (actual.channelId !== profile.expectedChannelId) {
		throw new Error(
			`Channel mismatch: expected channelId '${profile.expectedChannelId}' but got '${actual.channelId || "null"}'`,
		);
	}

	if (actual.handle !== profile.expectedChannelHandle) {
		console.warn(
			`[WARNING: CHANNEL MISMATCH] Expected handle '${profile.expectedChannelHandle}' but got '${actual.handle ?? "null"}'`,
		);
	}

	return { profile, actual };
}
