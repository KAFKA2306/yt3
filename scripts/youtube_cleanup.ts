import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

async function main() {
    const envFile = process.env.ENV_FILE;
    if (!envFile || !envFile.endsWith(".env.yawa")) {
        console.error("Error: ENV_FILE must be set to a yawa profile (e.g., config/.env.yawa)");
        process.exit(1);
    }

    if (!fs.existsSync(envFile)) {
        console.error(`Error: Env file not found: ${envFile}`);
        process.exit(1);
    }

    const envContent = fs.readFileSync(envFile, "utf-8");
    const getEnv = (key: string) => {
        const match = envContent.match(new RegExp(`${key}=(.*)`));
        return match ? match[1].trim() : undefined;
    };

    const isApply = process.argv.includes("--apply");
    console.log(isApply ? "🚀 APPLY MODE: Changes will be written to YouTube." : "🔍 DRY RUN: No changes will be made.");

    const refreshToken = getEnv("YOUTUBE_REFRESH_TOKEN");
    const clientId = getEnv("YOUTUBE_CLIENT_ID");
    const clientSecret = getEnv("YOUTUBE_CLIENT_SECRET");
    const expectedTitle = getEnv("YOUTUBE_EXPECTED_CHANNEL_TITLE") || "夜話アーカイブ ASMR";

    console.log(`Debug: Using Token starting with ${refreshToken?.substring(0, 10)}`);

    const auth = new google.auth.OAuth2({
        clientId: clientId,
        clientSecret: clientSecret,
    });
    auth.setCredentials({ refresh_token: refreshToken });

    const youtube = google.youtube({ version: "v3", auth });

    // 1. Verify channel
    const channelRes = await youtube.channels.list({
        part: ["snippet", "contentDetails"],
        mine: true,
    });
    const channel = channelRes.data.items?.[0];
    if (!channel) throw new Error("Channel not found");
    
    if (channel.snippet?.title !== expectedTitle) {
        throw new Error(`Channel title mismatch! Expected: ${expectedTitle}, Found: ${channel.snippet?.title}`);
    }
    console.log(`✅ Target Channel: ${channel.snippet?.title}`);

    const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) throw new Error("Uploads playlist not found");

    // 2. Fetch all videos from uploads playlist
    let videoIds: string[] = [];
    let nextPageToken: string | undefined;
    
    do {
        const res = await youtube.playlistItems.list({
            part: ["snippet"],
            playlistId: uploadsPlaylistId,
            maxResults: 50,
            pageToken: nextPageToken,
        });
        const ids = res.data.items?.map(item => item.snippet?.resourceId?.videoId).filter((id): id is string => !!id) || [];
        videoIds = [...videoIds, ...ids];
        nextPageToken = res.data.nextPageToken || undefined;
    } while (nextPageToken);

    console.log(`📊 Found ${videoIds.length} total videos.`);

    // 3. Get detailed info for all videos (max 50 per request)
    const videos: any[] = [];
    for (let i = 0; i < videoIds.length; i += 50) {
        const chunk = videoIds.slice(i, i + 50);
        const res = await youtube.videos.list({
            part: ["snippet", "status", "contentDetails"],
            id: chunk,
        });
        videos.push(...(res.data.items || []));
    }

    // 4. Analysis & Decision
    const report: string[] = ["# YouTube Cleanup Report (夜話アーカイブ ASMR)", `Date: ${new Date().toISOString()}`, ""];
    const decisions: { id: string, title: string, action: string, reason: string }[] = [];
    
    // Grouping for deduplication
    const groups = new Map<string, any[]>();
    for (const v of videos) {
        const key = `${v.snippet.title}_${v.contentDetails.duration}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(v);
    }

    for (const [key, group] of groups.entries()) {
        // Sort within group by priority
        // 1. Current status is Public (avoid changing public to private if possible)
        // 2. description length (specific)
        // 3. title specificity (not "ASMR Archive")
        // 4. earliest publishedAt
        group.sort((a, b) => {
            const aPublic = a.status.privacyStatus === "public" ? 1 : 0;
            const bPublic = b.status.privacyStatus === "public" ? 1 : 0;
            if (aPublic !== bPublic) return bPublic - aPublic;

            const aTitleSpecific = a.snippet.title !== "ASMR Archive" ? 1 : 0;
            const bTitleSpecific = b.snippet.title !== "ASMR Archive" ? 1 : 0;
            if (aTitleSpecific !== bTitleSpecific) return bTitleSpecific - aTitleSpecific;

            const aDescLen = a.snippet.description?.length || 0;
            const bDescLen = b.snippet.description?.length || 0;
            if (aDescLen !== bDescLen) return bDescLen - aDescLen;

            return new Date(a.snippet.publishedAt).getTime() - new Date(b.snippet.publishedAt).getTime();
        });

        const best = group[0];
        
        for (let i = 0; i < group.length; i++) {
            const v = group[i];
            const videoId = v.id;
            const title = v.snippet.title;
            const currentPrivacy = v.status.privacyStatus;
            
            let action = "KEEP";
            let reason = "Valid unique video";

            if (title === "ASMR Archive") {
                action = "PRIVATE";
                reason = "Placeholder title 'ASMR Archive'";
            } else if (title.includes("[TEST]")) {
                action = "PRIVATE";
                reason = "Test video";
            } else if (i > 0) {
                action = "PRIVATE";
                reason = `Duplicate of ${best.id} (same title and duration)`;
            }

            // Safety: Never change to public or delete
            if (action === "PRIVATE" && currentPrivacy === "private") {
                action = "SKIP";
                reason += " (Already private)";
            }
            
            if (action === "KEEP" && currentPrivacy === "private") {
                action = "SKIP";
                reason = "Should be public but currently private (Publicize manually)";
            }

            decisions.push({ id: videoId, title, action, reason });
        }
    }

    // 5. Execution
    report.push("## Audit Results", "");
    report.push("| Video ID | Title | Action | Status (Before) | Reason |");
    report.push("| --- | --- | --- | --- | --- |");

    for (const d of decisions) {
        const v = videos.find(v => v.id === d.id);
        const beforeStatus = v.status.privacyStatus;
        let afterStatus = beforeStatus;

        if (d.action === "PRIVATE") {
            if (isApply) {
                try {
                    await youtube.videos.update({
                        part: ["status"],
                        requestBody: {
                            id: d.id,
                            status: { privacyStatus: "private" }
                        }
                    });
                    afterStatus = "private";
                    console.log(`✅ Updated ${d.id} to PRIVATE`);
                } catch (err) {
                    console.error(`❌ Failed to update ${d.id}:`, err);
                }
            } else {
                afterStatus = "private (pending)";
                console.log(`[DRY RUN] Would update ${d.id} (${d.title}) to PRIVATE`);
            }
        }

        report.push(`| ${d.id} | ${d.title} | ${d.action} | ${beforeStatus} -> ${afterStatus} | ${d.reason} |`);
    }

    const reportPath = `docs/yawa_cleanup_report_${new Date().toISOString().split('T')[0]}.md`;
    fs.writeFileSync(reportPath, report.join("\n"));
    console.log(`\n📄 Report saved to ${reportPath}`);
}

main().catch(console.error);
