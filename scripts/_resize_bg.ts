import path from "node:path";
/**
 * Resize and copy AI-generated background for thumbnail regeneration
 */
import sharp from "sharp";

const SRC =
  "/root/.gemini/antigravity/brain/d3131940-d309-4e9c-8cb5-2d717c1a3949/thumbnail_bg_20260222_1771723448201.png";
const DEST = "runs/run_20260222_antigravity/media/thumbnail_bg.png";

const result = await sharp(SRC)
  .resize(1280, 720, { fit: "cover", position: "center" })
  .png()
  .toFile(DEST);

console.log("Saved:", DEST, result);
