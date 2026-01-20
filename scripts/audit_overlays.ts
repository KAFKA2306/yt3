import path from "path";
import fs from "fs-extra";
import sharp from "sharp";
import { LayoutEngine } from "../src/layout_engine.js";
import { loadConfig } from "../src/config.js";

async function main() {
    console.log("Starting Layout Audit...");
    const layout = new LayoutEngine();

    // 1. Audit Video Layout
    console.log("Auditing Video Layout...");
    const videoPlan = await layout.createVideoRenderPlan();

    await layout.renderDebugVisuals(videoPlan, "min_layout_audit_video.png");
    console.log("Saved min_layout_audit_video.png");

    // 2. Audit Thumbnail Layout
    console.log("Auditing Thumbnail Layout...");
    const thumbPlan = await layout.createThumbnailRenderPlan();

    await layout.renderDebugVisuals(thumbPlan, "min_layout_audit_thumbnail.png");
    console.log("Saved min_layout_audit_thumbnail.png");
}

main().catch(console.error);
