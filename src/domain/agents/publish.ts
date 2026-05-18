import fs from "fs-extra";
import { google } from "googleapis";
import { TwitterApi } from "twitter-api-v2";
import { type AssetStore, BaseAgent, RunStage } from "../../io/core.js";
import { sendAlert } from "../../io/utils/discord.js";
import type { AgentState, AppConfig, PublishResults } from "../types.js";
import { validateCredentials } from "../validation.js";
import {
	assertYouTubeChannelMatchesProfile,
	getYouTubeProfile,
	hydrateOAuthCredentials,
	resolveYouTubeRedirectUri,
} from "../youtube_profiles.js";
export class PublishAgent extends BaseAgent {
	constructor(store: AssetStore) {
		super(store, RunStage.PUBLISH);
		this.validateInitialization();
	}

	private validateInitialization() {
		const enabledProviders = {
			youtube: !!this.config.steps.youtube?.enabled,
			twitter: !!this.config.steps.twitter?.enabled,
		};
		if (enabledProviders.youtube || enabledProviders.twitter) {
			validateCredentials(enabledProviders);
		}
		if (enabledProviders.youtube) {
			const profileName = process.env.YOUTUBE_CHANNEL_PROFILE?.trim();
			if (
				!profileName ||
				profileName === "default" ||
				profileName === "config/.env"
			) {
				throw new Error(
					"YouTube publish requires an explicit channel profile (set YOUTUBE_CHANNEL_PROFILE to byosan_money or yawa_archive_asmr)",
				);
			}

			if (
				profileName === "humanity" ||
				profileName === "humanity_observatory"
			) {
				getYouTubeProfile(profileName);
			} else {
				const expectedTitle =
					process.env.YOUTUBE_EXPECTED_CHANNEL_TITLE?.trim();
				const expectedId = process.env.YOUTUBE_EXPECTED_CHANNEL_ID?.trim();
				if (!expectedTitle && !expectedId) {
					throw new Error(
						"YouTube publish requires YOUTUBE_EXPECTED_CHANNEL_TITLE or YOUTUBE_EXPECTED_CHANNEL_ID",
					);
				}
			}
		}
	}
	async run(state: AgentState): Promise<PublishResults> {
		this.logInput({ video_path: state.video_path, metadata: state.metadata });
		const results: PublishResults = {};
		const ytStep = this.config.steps.youtube;
		if (ytStep?.enabled) {
			results.youtube = await this.uploadToYouTube(state, this.config);
			if (results.youtube?.status === "uploaded") {
				const videoId = results.youtube.video_id;
				const channelTitle = results.youtube.channel_title || "YouTube Channel";
				const videoUrl = videoId
					? `https://www.youtube.com/watch?v=${videoId}`
					: "N/A";
				await sendAlert(
					`✅ **Successfully Published** video to ${channelTitle}!`,
					"publish",
					{
						title: state.metadata?.title || "N/A",
						videoId: videoId || "N/A",
						url: videoUrl,
						runId: state.run_id,
					},
				);
			}
		}
		const twStep = this.config.steps.twitter;
		if (twStep?.enabled) {
			results.twitter = await this.postToTwitter(state, this.config);
			if (results.twitter?.status === "posted") {
				await sendAlert(
					"🐦 **Successfully Posted** to Twitter (X)!",
					"publish",
					{
						tweetId: results.twitter.tweet_id || "N/A",
						title: state.metadata?.title || "N/A",
						runId: state.run_id,
					},
				);
			}
		}
		this.logOutput(results);
		return results;
	}
	private async uploadToYouTube(
		state: AgentState,
		cfg: AppConfig,
	): Promise<PublishResults["youtube"]> {
		const ytCfg = cfg.steps.youtube;
		if (!ytCfg) throw new Error("YouTube config missing");
		if (!ytCfg.default_visibility) {
			throw new Error(
				"YouTube publish failed: steps.youtube.default_visibility is missing in config/default.yaml",
			);
		}

		console.log(
			`[PUBLISH:CONFIG] visibility=${ytCfg.default_visibility} source=config/default.yaml`,
		);

		const auth = await this.createYouTubeClient();
		const youtube = google.youtube({
			version: "v3",
			auth,
		});
		await this.verifyYouTubeChannel(youtube, auth);
		const { video_path: videoPath, thumbnail_path: thumbnailPath } = state;
		if (!videoPath) throw new Error("Video path missing");
		const res = await youtube.videos.insert({
			part: ["snippet", "status"],
			requestBody: this.createYouTubeSnippet(state, ytCfg),
			media: { body: fs.createReadStream(videoPath) },
		});
		const videoId = res.data.id;
		const snippet = res.data.snippet;
		const status = res.data.status;

		if (videoId && thumbnailPath) {
			try {
				await this.setYouTubeThumbnail(youtube, videoId, thumbnailPath);
			} catch (error) {
				console.warn(
					`YouTube thumbnail upload skipped for ${videoId}: ${(error as Error).message}`,
				);
			}
		}
		return {
			status: "uploaded",
			video_id: videoId || "",
			channel_id: snippet?.channelId || "",
			channel_title: snippet?.channelTitle || "",
			privacy_status: status?.privacyStatus || "",
			published_at: snippet?.publishedAt || "",
		};
	}
	private createYouTubeSnippet(
		state: AgentState,
		ytCfg: NonNullable<AppConfig["steps"]["youtube"]>,
	) {
		const metadata = state.metadata;
		return {
			snippet: {
				title: (metadata?.title || "").substring(0, ytCfg.max_title_length),
				description: (metadata?.description || "").substring(
					0,
					ytCfg.max_description_length,
				),
				tags: [...(ytCfg.default_tags || []), ...(metadata?.tags || [])],
				categoryId: (ytCfg.category_id || 24).toString(),
			},
			status: {
				privacyStatus: ytCfg.default_visibility,
				selfDeclaredMadeForKids: false,
			},
		};
	}
	private async verifyYouTubeChannel(
		youtube: ReturnType<typeof google.youtube>,
		auth: InstanceType<typeof google.auth.OAuth2>,
	) {
		const profileName =
			process.env.YOUTUBE_CHANNEL_PROFILE?.trim() || "unknown";

		if (profileName === "humanity" || profileName === "humanity_observatory") {
			const profile = getYouTubeProfile(profileName);
			await assertYouTubeChannelMatchesProfile(auth, profile);
			return;
		}

		const expectedTitle = process.env.YOUTUBE_EXPECTED_CHANNEL_TITLE?.trim();
		const expectedId = process.env.YOUTUBE_EXPECTED_CHANNEL_ID?.trim();
		const requireMatch = process.env.YOUTUBE_REQUIRE_CHANNEL_MATCH === "true";

		if (!expectedTitle && !expectedId && !requireMatch) {
			throw new Error(
				`YouTube channel preflight requires an explicit expected channel for profile "${profileName}"`,
			);
		}

		const res = await youtube.channels.list({
			part: ["id", "snippet"],
			mine: true,
		});
		const channel = res.data.items?.[0];
		const actualTitle = channel?.snippet?.title?.trim();
		const actualId = channel?.id?.trim();

		if (!channel) {
			throw new Error(
				`YouTube channel preflight failed for profile "${profileName}": no channel returned`,
			);
		}

		if (expectedTitle && actualTitle !== expectedTitle) {
			throw new Error(
				`Wrong YouTube channel for profile "${profileName}": expected "${expectedTitle}" but got "${actualTitle || "unknown"}"`,
			);
		}

		if (expectedId && actualId !== expectedId) {
			throw new Error(
				`Wrong YouTube channel ID for profile "${profileName}": expected "${expectedId}" but got "${actualId || "unknown"}"`,
			);
		}

		if (requireMatch && !expectedTitle && !expectedId) {
			throw new Error(
				`YouTube channel preflight is required for profile "${profileName}" but no expected channel was configured`,
			);
		}
	}
	private async createYouTubeClient() {
		const clientId = process.env.YOUTUBE_CLIENT_ID;
		const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
		const redirectUri =
			process.env.YOUTUBE_REDIRECT_URI ||
			"http://localhost:3000/oauth2callback";

		if (!clientId || !clientSecret) {
			throw new Error(
				"YouTube authentication failed: unable to initialize YouTube client",
			);
		}

		const client = new google.auth.OAuth2({
			clientId,
			clientSecret,
			redirectUri,
		});

		const profileName =
			process.env.YOUTUBE_CHANNEL_PROFILE?.trim() || "unknown";

		if (profileName === "humanity" || profileName === "humanity_observatory") {
			const profile = getYouTubeProfile(profileName);
			await hydrateOAuthCredentials(client, profile);
		} else {
			const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
			if (refreshToken) {
				client.setCredentials({ refresh_token: refreshToken });
			}
		}

		return client;
	}
	private async setYouTubeThumbnail(
		youtube: ReturnType<typeof google.youtube>,
		videoId: string,
		thumbnailPath: string,
	) {
		await youtube.thumbnails.set({
			videoId: videoId,
			media: {
				mimeType: "image/png",
				body: fs.createReadStream(thumbnailPath),
			},
		});
	}
	private async postToTwitter(
		state: AgentState,
		cfg: AppConfig,
	): Promise<PublishResults["twitter"]> {
		const twCfg = cfg.steps.twitter;
		if (!twCfg) throw new Error("Twitter config missing");

		const client = this.createTwitterClient();
		const { metadata, video_path: videoPath } = state;
		let mediaId: string | undefined;
		if (videoPath && fs.existsSync(videoPath))
			mediaId = await client.v1.uploadMedia(videoPath);
		const tweetText = this.createTweetText(metadata);
		const tweetPayload = { text: tweetText } as {
			text: string;
			media?: { media_ids: string[] };
		};
		if (mediaId) tweetPayload.media = { media_ids: [mediaId] };
		const res = await client.v2.tweet(tweetPayload as { text: string });
		return { status: "posted", tweet_id: res.data.id || "" };
	}
	private createTwitterClient() {
		const appKey = process.env.X_API_KEY || process.env.TWITTER_API_KEY;
		const appSecret =
			process.env.X_API_SECRET || process.env.TWITTER_API_SECRET;
		const accessToken =
			process.env.X_ACCESS_TOKEN || process.env.TWITTER_ACCESS_TOKEN;
		const accessSecret =
			process.env.X_ACCESS_SECRET || process.env.TWITTER_ACCESS_TOKEN_SECRET;

		if (!appKey || !appSecret || !accessToken || !accessSecret) {
			throw new Error(
				"Twitter authentication failed: unable to initialize Twitter client",
			);
		}

		return new TwitterApi({
			appKey,
			appSecret,
			accessToken,
			accessSecret,
		});
	}
	private createTweetText(metadata?: AgentState["metadata"]) {
		const tags = (metadata?.tags || []).map((t) => `#${t}`).join(" ");
		return `${metadata?.title || ""}\n\n${tags}`.substring(0, 280);
	}
}
