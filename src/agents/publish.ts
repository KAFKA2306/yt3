import fs from "fs-extra";
import path from "path";
import { google } from "googleapis";
import { TwitterApi } from "twitter-api-v2";
import { AssetStore, loadConfig } from "../core.js";

export class PublishAgent {
    store: AssetStore;
    config: any;

    constructor(store: AssetStore) {
        this.store = store;
        this.config = loadConfig();
    }

    async run(state: any): Promise<any> {
        this.store.logInput("publish", { video_path: state.video_path, metadata: state.metadata });
        const results: any = {};

        if (this.config.steps.youtube?.enabled) {
            results.youtube = await this.uploadToYouTube(state);
        }

        if (this.config.steps.twitter?.enabled) {
            results.twitter = await this.postToTwitter(state);
        }

        this.store.logOutput("publish", results);
        return results;
    }

    private async uploadToYouTube(state: any): Promise<any> {
        const ytCfg = this.config.steps.youtube;
        if (ytCfg.dry_run) {
            console.log("[YouTube] Dry run enabled, skipping upload.");
            return { status: "dry_run", video_id: "dry_run_id" };
        }

        // Implementation Note: In v2, this used a local token.pickle and secret JSON.
        // For v3, we expect YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REFRESH_TOKEN in .env
        // to avoid interactive browser flows in automated environments.
        const oauth2Client = new google.auth.OAuth2(
            process.env.YOUTUBE_CLIENT_ID,
            process.env.YOUTUBE_CLIENT_SECRET,
            "http://localhost"
        );

        oauth2Client.setCredentials({
            refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
        });

        const youtube = google.youtube({ version: "v3", auth: oauth2Client });

        const metadata = state.metadata;
        const videoPath = state.video_path;
        const thumbnailPath = state.thumbnail_path;

        console.log(`[YouTube] Uploading: ${videoPath}`);

        const res = await youtube.videos.insert({
            part: ["snippet", "status"],
            requestBody: {
                snippet: {
                    title: metadata.title.substring(0, ytCfg.max_title_length),
                    description: metadata.description.substring(0, ytCfg.max_description_length),
                    tags: [...ytCfg.default_tags, ...metadata.tags],
                    categoryId: ytCfg.category_id.toString(),
                },
                status: {
                    privacyStatus: ytCfg.default_visibility,
                    selfDeclaredMadeForKids: false,
                },
            },
            media: {
                body: fs.createReadStream(videoPath),
            },
        });

        const videoId = res.data.id;
        console.log(`[YouTube] Uploaded successfully: ${videoId}`);

        if (thumbnailPath && videoId) {
            console.log(`[YouTube] Setting thumbnail: ${thumbnailPath}`);
            await youtube.thumbnails.set({
                videoId: videoId,
                media: {
                    mimeType: "image/png",
                    body: fs.createReadStream(thumbnailPath),
                },
            });
        }

        return {
            status: "uploaded",
            video_id: videoId,
            url: `https://www.youtube.com/watch?v=${videoId}`
        };
    }

    private async postToTwitter(state: any): Promise<any> {
        const twCfg = this.config.steps.twitter;
        if (twCfg.dry_run) {
            console.log("[Twitter] Dry run enabled, skipping post.");
            return { status: "dry_run", tweet_id: "dry_run_id" };
        }

        // twitter-api-v2 supports OAuth 1.1a and OAuth 2.0. v2 used OAuth 1.1a (API Key/Secret + Access Token/Secret)
        const client = new TwitterApi({
            appKey: process.env.X_API_KEY || process.env.TWITTER_API_KEY || "",
            appSecret: process.env.X_API_SECRET || process.env.TWITTER_API_SECRET || "",
            accessToken: process.env.X_ACCESS_TOKEN || process.env.TWITTER_ACCESS_TOKEN || "",
            accessSecret: process.env.X_ACCESS_SECRET || process.env.TWITTER_ACCESS_TOKEN_SECRET || "",
        });

        const metadata = state.metadata;
        const videoPath = state.video_path;

        // Note: v2 created a 60s clip for Twitter. 
        // For simplicity in this port, we post the full video if it meets Twitter requirements,
        // or just the text/link if needed. The user can refine clip logic later.
        console.log(`[Twitter] Posting tweet for: ${metadata.title}`);

        let mediaId: string | undefined;
        if (videoPath && fs.existsSync(videoPath)) {
            console.log(`[Twitter] Uploading media: ${videoPath}`);
            mediaId = await client.v1.uploadMedia(videoPath);
        }

        const tweetText = `${metadata.title}\n\n${metadata.tags.map((t: string) => `#${t}`).join(" ")}`.substring(0, 280);
        const res = await client.v2.tweet({
            text: tweetText,
            media: mediaId ? { media_ids: [mediaId] } : undefined
        });

        console.log(`[Twitter] Posted successfully: ${res.data.id}`);

        return {
            status: "posted",
            tweet_id: res.data.id
        };
    }
}
