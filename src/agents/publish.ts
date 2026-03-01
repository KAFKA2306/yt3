import fs from "fs-extra";
import { google } from "googleapis";
import { TwitterApi } from "twitter-api-v2";
import { type AssetStore, BaseAgent, RunStage } from "../core.js";
import type { AgentState, AppConfig, PublishResults } from "../types.js";
export class PublishAgent extends BaseAgent {
	constructor(store: AssetStore) {
		super(store, RunStage.PUBLISH);
	}
	async run(state: AgentState): Promise<PublishResults> {
		this.logInput({ video_path: state.video_path, metadata: state.metadata });
		const results: PublishResults = {};
		const ytStep = this.config.steps.youtube;
		if (ytStep?.enabled)
			results.youtube = await this.uploadToYouTube(state, this.config);
		const twStep = this.config.steps.twitter;
		if (twStep?.enabled)
			results.twitter = await this.postToTwitter(state, this.config);
		this.logOutput(results);
		return results;
	}
	private async uploadToYouTube(
		state: AgentState,
		cfg: AppConfig,
	): Promise<PublishResults["youtube"]> {
		const ytCfg = cfg.steps.youtube;
		if (!ytCfg) throw new Error("YouTube config missing");

		const youtube = google.youtube({
			version: "v3",
			auth: this.createYouTubeClient(),
		});
		const { video_path: videoPath, thumbnail_path: thumbnailPath } = state;
		if (!videoPath) throw new Error("Video path missing");
		const res = await youtube.videos.insert({
			part: ["snippet", "status"],
			requestBody: this.createYouTubeSnippet(state, ytCfg),
			media: { body: fs.createReadStream(videoPath) },
		});
		const videoId = res.data.id;
		if (videoId && thumbnailPath)
			await this.setYouTubeThumbnail(youtube, videoId, thumbnailPath);
		return { status: "uploaded", video_id: videoId || "" };
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
				privacyStatus: ytCfg.default_visibility || "public",
				selfDeclaredMadeForKids: false,
			},
		};
	}
	private createYouTubeClient() {
		const clientId = process.env.YOUTUBE_CLIENT_ID;
		const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
		if (!clientId || !clientSecret)
			throw new Error("YouTube credentials missing");
		const client = new google.auth.OAuth2({
			clientId,
			clientSecret,
			redirectUri:
				process.env.YOUTUBE_REDIRECT_URI ||
				"http://localhost:3000/oauth2callback",
		});
		const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
		if (refreshToken) {
			client.setCredentials({ refresh_token: refreshToken });
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
		return new TwitterApi({
			appKey: process.env.X_API_KEY || process.env.TWITTER_API_KEY || "",
			appSecret:
				process.env.X_API_SECRET || process.env.TWITTER_API_SECRET || "",
			accessToken:
				process.env.X_ACCESS_TOKEN || process.env.TWITTER_ACCESS_TOKEN || "",
			accessSecret:
				process.env.X_ACCESS_SECRET ||
				process.env.TWITTER_ACCESS_TOKEN_SECRET ||
				"",
		});
	}
	private createTweetText(metadata?: AgentState["metadata"]) {
		const tags = (metadata?.tags || []).map((t) => `#${t}`).join(" ");
		return `${metadata?.title || ""}\n\n${tags}`.substring(0, 280);
	}
}
