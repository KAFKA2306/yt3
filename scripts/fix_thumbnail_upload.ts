import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { google } from "googleapis";
import { AssetStore, RunStage, loadConfig } from "../src/core.js";

async function main() {
  const runId = "run_20260219_antigravity";
  const store = new AssetStore(runId);

  // Load publish state to get video ID
  const publishState = store.load<{ youtube: { video_id: string } }>(RunStage.PUBLISH, "output");
  const videoId = publishState.youtube?.video_id;

  if (!videoId || videoId === "dry_run_id") {
    console.error("No valid video ID found.");
    process.exit(1);
  }

  console.log(`Fixing thumbnail for Video ID: ${videoId}`);

  // Path to the CORRECT thumbnail
  const correctThumbnailPath = path.join(store.runDir, "publish", "thumbnail.png");
  const optimizedThumbnailPath = path.join(store.runDir, "publish", "thumbnail_optimized.jpg"); // Use JPG for better compression

  if (!fs.existsSync(correctThumbnailPath)) {
    console.error(`Correct thumbnail not found at ${correctThumbnailPath}`);
    process.exit(1);
  }

  // Compress using ffmpeg
  console.log(`Compressing thumbnail to ${optimizedThumbnailPath}...`);
  // -q:v 5 is decent quality (1-31, lower is better). 2-5 usually good for thumbnails.
  spawnSync("ffmpeg", ["-y", "-i", correctThumbnailPath, "-q:v", "5", optimizedThumbnailPath]);

  const stats = fs.statSync(optimizedThumbnailPath);
  console.log(`Optimized size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

  if (stats.size > 2 * 1024 * 1024) {
    console.error("Still too large! Try lower quality.");
    process.exit(1);
  }

  // Auth setup
  const client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI || "http://localhost",
  );
  client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });

  const youtube = google.youtube({ version: "v3", auth: client });

  // Upload
  console.log(`Uploading thumbnail from: ${optimizedThumbnailPath}`);
  await youtube.thumbnails.set({
    videoId: videoId,
    media: {
      mimeType: "image/jpeg",
      body: fs.createReadStream(optimizedThumbnailPath),
    },
  });

  console.log("Thumbnail updated successfully.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
