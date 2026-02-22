import path from "node:path";
import fs from "fs-extra";
import { AssetStore, RunStage, loadConfig, resolvePath } from "../src/core.js";
import { LayoutEngine } from "../src/layout_engine.js";
import type { OverlayConfig, Rect } from "../src/types.js";

async function main() {
  const runId = process.argv[2] || "run_20260218_antigravity";
  const store = new AssetStore(runId);

  // Load content for title
  const content = store.load<any>(RunStage.CONTENT, "output");
  const title =
    content.thumbnail_title ||
    content.thumbnail_text ||
    content.metadata?.thumbnail_title ||
    content.metadata?.title ||
    content.script?.title ||
    content.title;

  console.log(`Generating thumbnail for run: ${runId}`);
  console.log(`Title: ${title}`);

  const layout = new LayoutEngine();

  // Create the standard render plan from config (gets character overlays etc.)
  const originalPlan = await layout.createThumbnailRenderPlan();

  // Path to our generated background
  const bgPath = path.join(store.runDir, "media", "thumbnail_bg.png");

  if (!fs.existsSync(bgPath)) {
    console.error(`Background image not found at ${bgPath}`);
    process.exit(1);
  }

  // Create a new overlay for the background
  const bgOverlay: { config: OverlayConfig; resolvedPath: string; bounds: Rect } = {
    config: {
      name: "generated_background",
      type: "overlay",
      enabled: true,
      image_path: bgPath,
      anchor: "top_left",
      // We want it to cover the whole canvas. LayoutEngine defaults to 1280x720.
      width: 1280,
      height: 720,
      offset: { top: 0, left: 0, right: 0, bottom: 0 },
    } as any,
    resolvedPath: bgPath,
    bounds: { x: 0, y: 0, width: 1280, height: 720 },
  };

  // Inject background at the beginning of the overlays array so it's behind everything
  const newPlan = {
    ...originalPlan,
    overlays: [bgOverlay, ...originalPlan.overlays],
  };

  // Output path
  const outputPath = path.join(store.runDir, "publish", "thumbnail.png");
  fs.ensureDirSync(path.dirname(outputPath));

  // Render
  await layout.renderThumbnail(newPlan, title, outputPath);

  console.log(`Thumbnail generated at: ${outputPath}`);
}

main().catch(console.error);
