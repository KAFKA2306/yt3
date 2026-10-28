import path from "node:path";
import fs from "fs-extra";
import { google } from "googleapis";
import { getByosanProductionConfig } from "../domain/byosan/production_config.js";
import { buildThumbnailFiles } from "../domain/byosan/thumbnail.js";
import { getByosanVisualSystem } from "../domain/design/kafka_visual_system.js";
import {
	YOUTUBE_PROFILES,
	assertYouTubeChannelMatchesProfile,
	createYouTubeOAuthClient,
} from "../domain/youtube_profiles.js";
import { ROOT } from "../io/core.js";

const TEXT_FLAG = "--text=";
const config = getByosanProductionConfig();
const F = config.feature_production;
const RUN = F.run_layout;
const design = getByosanVisualSystem();
const profile = YOUTUBE_PROFILES.byosan;

const args = process.argv.slice(2);
const runId = args.find((arg) => !arg.startsWith("--"));
const text = args
	.find((arg) => arg.startsWith(TEXT_FLAG))
	?.slice(TEXT_FLAG.length);
if (!runId || !text) {
	throw new Error(
		"usage: byosan_thumbnail.ts byosan_money/YYYY-MM-DD-slot --text=<question> [--dry]",
	);
}
const runDir = path.join(ROOT, config.workflow.paths.runs_dir, runId);
const outDir = path.join(runDir, RUN.publish_dir, "thumbnail_question");
await fs.ensureDir(outDir);
const jpgPath = path.join(outDir, "thumbnail.jpg");
await buildThumbnailFiles({
	text,
	artPath: path.join(outDir, "art.png"),
	refs: [
		path.join(ROOT, F.characters.tsumugi_image),
		path.join(ROOT, F.characters.zundamon_image),
	],
	fullPath: path.join(outDir, "full.png"),
	pngPath: path.join(outDir, "thumbnail.png"),
	jpgPath,
	brand: F.brand_label,
	width: design.canvas.landscape.width,
	height: design.canvas.landscape.height,
	thumbnailWidth: design.canvas.thumbnail.width,
	thumbnailHeight: design.canvas.thumbnail.height,
	font: design.typography.japanese,
	fontWeight: design.typography.weights.headline ?? "bold",
	halfWidthUnits: F.captions.half_width_units,
	pngCompression: F.image.png_compression_level,
	config: F.thumbnail,
});
console.log(`THUMBNAIL=${jpgPath}`);
if (args.includes("--dry")) process.exit(0);

const receipt = fs.readJsonSync(
	path.join(runDir, RUN.publish_dir, "receipt.json"),
) as { youtube: { video_id: string } };
const videoId = receipt.youtube.video_id;
const { auth } = await createYouTubeOAuthClient(profile.profileName);
await assertYouTubeChannelMatchesProfile(auth, profile);
const youtube = google.youtube({ version: "v3", auth });
await youtube.thumbnails.set({
	videoId,
	media: { mimeType: "image/jpeg", body: fs.createReadStream(jpgPath) },
});
fs.appendFileSync(
	path.join(runDir, RUN.publish_dir, "thumbnail_updates.jsonl"),
	`${JSON.stringify({ at: new Date().toISOString(), run_id: runId, video_id: videoId, text })}\n`,
);
console.log(JSON.stringify({ run_id: runId, video_id: videoId, set: true }));
