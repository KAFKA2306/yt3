import fs from "fs-extra";
import { google } from "googleapis";
import { TwitterApi } from "twitter-api-v2";
import { AssetStore, loadConfig, BaseAgent } from "../core.js";
import { AgentState, AppConfig, PublishResults } from "../types.js";

export class PublishAgent extends BaseAgent {
    config: AppConfig;

    constructor(store: AssetStore) {
        super(store, "publish");
        this.config = loadConfig();
    }

    async run(state: AgentState): Promise<PublishResults> {
        this.logInput({ video_path: state.video_path, metadata: state.metadata });
        const results: PublishResults = {};
        if (this.config.steps.youtube?.enabled) results.youtube = await this.uploadToYouTube(state);
        if (this.config.steps.twitter?.enabled) results.twitter = await this.postToTwitter(state);
        this.logOutput(results);
        return results;
    }

    private async uploadToYouTube(state: AgentState): Promise<PublishResults["youtube"]> {
        const ytCfg = this.config.steps.youtube;
        if (!ytCfg) throw new Error("YouTube config missing");
        if (ytCfg.dry_run) return { status: "dry_run", video_id: "dry_run_id" };

        const youtube = google.youtube({ version: "v3", auth: this.createYouTubeClient() });
        const { video_path: videoPath, thumbnail_path: thumbnailPath } = state;

        if (!videoPath) throw new Error("Video path missing");

        if (this.config.steps.thumbnail.enabled && (!thumbnailPath || !fs.existsSync(thumbnailPath))) {
            throw new Error(`[PublishAgent] Thumbnail missing: ${thumbnailPath}`);
        }

        const res = await youtube.videos.insert({
            part: ["snippet", "status"],
            requestBody: this.createYouTubeSnippet(state, ytCfg),
            media: { body: fs.createReadStream(videoPath) },
        });

        const videoId = res.data.id;
        if (videoId && thumbnailPath) await this.setYouTubeThumbnail(youtube, videoId, thumbnailPath);
        return { status: "uploaded", video_id: videoId || "" };
    }

    private createYouTubeSnippet(state: AgentState, ytCfg: NonNullable<AppConfig["steps"]["youtube"]>) {
        const metadata = state.metadata;
        return {
            snippet: {
                title: (metadata?.title || "").substring(0, ytCfg.max_title_length),
                description: (metadata?.description || "").substring(0, ytCfg.max_description_length),
                tags: [...(ytCfg.default_tags || []), ...(metadata?.tags || [])],
                categoryId: (ytCfg.category_id || 24).toString(),
            },
            status: { privacyStatus: ytCfg.default_visibility || "public", selfDeclaredMadeForKids: false },
        };
    }

    private createYouTubeClient() {
        const client = new google.auth.OAuth2(process.env.YOUTUBE_CLIENT_ID, process.env.YOUTUBE_CLIENT_SECRET, process.env.YOUTUBE_REDIRECT_URI || `http://localhost`);
        client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
        return client;
    }

    private async setYouTubeThumbnail(youtube: ReturnType<typeof google.youtube>, videoId: string, thumbnailPath: string) {
        await youtube.thumbnails.set({
            videoId: videoId,
            media: { mimeType: "image/png", body: fs.createReadStream(thumbnailPath) },
        });
    }

    private async postToTwitter(state: AgentState): Promise<PublishResults["twitter"]> {
        const twCfg = this.config.steps.twitter;
        if (!twCfg) throw new Error("Twitter config missing");
        if (twCfg.dry_run) return { status: "dry_run", tweet_id: "dry_run_id" };

        const client = this.createTwitterClient();
        const { metadata, video_path: videoPath } = state;

        let mediaId: string | undefined;
        if (videoPath && fs.existsSync(videoPath)) mediaId = await client.v1.uploadMedia(videoPath);

        const tweetText = this.createTweetText(metadata);
        const res = await client.v2.tweet({ text: tweetText, media: mediaId ? { media_ids: [mediaId] } : undefined });
        return { status: "posted", tweet_id: res.data.id };
    }

    private createTwitterClient() {
        return new TwitterApi({
            appKey: process.env.X_API_KEY || process.env.TWITTER_API_KEY || "",
            appSecret: process.env.X_API_SECRET || process.env.TWITTER_API_SECRET || "",
            accessToken: process.env.X_ACCESS_TOKEN || process.env.TWITTER_ACCESS_TOKEN || "",
            accessSecret: process.env.X_ACCESS_SECRET || process.env.TWITTER_ACCESS_TOKEN_SECRET || "",
        });
    }

    private createTweetText(metadata?: AgentState["metadata"]) {
        const tags = (metadata?.tags || []).map(t => `#${t}`).join(" ");
        return `${metadata?.title || ""}\n\n${tags}`.substring(0, 280);
    }
}
