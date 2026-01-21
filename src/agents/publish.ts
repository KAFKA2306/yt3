import fs from "fs-extra";
import { google } from "googleapis";
import { TwitterApi } from "twitter-api-v2";
import { AssetStore, loadConfig } from "../core.js";
import { AgentState, AppConfig, PublishResults } from "../types.js";

export class PublishAgent {
    store: AssetStore;
    config: AppConfig;

    constructor(store: AssetStore) {
        this.store = store;
        this.config = loadConfig();
    }

    async run(state: AgentState): Promise<PublishResults> {
        this.store.logInput("publish", { video_path: state.video_path, metadata: state.metadata });
        const results: PublishResults = {};

        if (this.config.steps.youtube?.enabled) results.youtube = await this.uploadToYouTube(state);
        if (this.config.steps.twitter?.enabled) results.twitter = await this.postToTwitter(state);

        this.store.logOutput("publish", results);
        return results;
    }

    private async uploadToYouTube(state: AgentState): Promise<PublishResults["youtube"]> {
        const ytCfg = this.config.steps.youtube!;
        if (ytCfg.dry_run) return { status: "dry_run", video_id: "dry_run_id" };

        const oauth2Client = new google.auth.OAuth2(process.env.YOUTUBE_CLIENT_ID, process.env.YOUTUBE_CLIENT_SECRET, "http://localhost");
        oauth2Client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });

        const youtube = google.youtube({ version: "v3", auth: oauth2Client });
        const { metadata, video_path: videoPath, thumbnail_path: thumbnailPath } = state;

        const res = await youtube.videos.insert({
            part: ["snippet", "status"],
            requestBody: {
                snippet: {
                    title: (metadata?.title || "").substring(0, ytCfg.max_title_length),
                    description: (metadata?.description || "").substring(0, ytCfg.max_description_length),
                    tags: [...(ytCfg.default_tags || []), ...(metadata?.tags || [])],
                    categoryId: (ytCfg.category_id || 24).toString(),
                },
                status: { privacyStatus: ytCfg.default_visibility || "public", selfDeclaredMadeForKids: false },
            },
            media: { body: fs.createReadStream(videoPath) },
        });

        const videoId = res.data.id;
        return { status: "uploaded", video_id: videoId || "" };
    }

    private async postToTwitter(state: AgentState): Promise<PublishResults["twitter"]> {
        const twCfg = this.config.steps.twitter!;
        if (twCfg.dry_run) return { status: "dry_run", tweet_id: "dry_run_id" };

        const client = new TwitterApi({
            appKey: process.env.X_API_KEY || process.env.TWITTER_API_KEY || "",
            appSecret: process.env.X_API_SECRET || process.env.TWITTER_API_SECRET || "",
            accessToken: process.env.X_ACCESS_TOKEN || process.env.TWITTER_ACCESS_TOKEN || "",
            accessSecret: process.env.X_ACCESS_SECRET || process.env.TWITTER_ACCESS_TOKEN_SECRET || "",
        });

        const { metadata, video_path: videoPath } = state;
        let mediaId: string | undefined;
        if (videoPath && fs.existsSync(videoPath)) mediaId = await client.v1.uploadMedia(videoPath);

        const tweetText = `${metadata?.title || ""}\n\n${(metadata?.tags || []).map(t => `#${t}`).join(" ")}`.substring(0, 280);
        const res = await client.v2.tweet({ text: tweetText, media: mediaId ? { media_ids: [mediaId] } : undefined });

        return { status: "posted", tweet_id: res.data.id };
    }
}
