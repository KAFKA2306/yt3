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

    // Draw visual audit
    const vw = videoPlan.canvas.width;
    const vh = videoPlan.canvas.height;

    const composites: sharp.OverlayOptions[] = [];

    // Background
    composites.push({
        input: { create: { width: vw, height: vh, channels: 4, background: '#193d5a' } },
        top: 0,
        left: 0
    });

    // Overlays
    for (const ol of videoPlan.overlays) {
        console.log(`Overlay: ${path.basename(ol.resolvedPath)} -> x:${ol.bounds.x}, y:${ol.bounds.y}, w:${ol.bounds.width}, h:${ol.bounds.height}`);
        // Draw Red Box
        const box = Buffer.from(`<svg width="${ol.bounds.width}" height="${ol.bounds.height}"><rect x="0" y="0" width="${ol.bounds.width}" height="${ol.bounds.height}" fill="none" stroke="red" stroke-width="5"/></svg>`);
        composites.push({ input: box, top: ol.bounds.y, left: ol.bounds.x });

        // Draw Actual Image (faded)
        const img = await sharp(ol.resolvedPath).resize(ol.bounds.width, ol.bounds.height).modulate({ brightness: 0.5 }).toBuffer();
        composites.push({ input: img, top: ol.bounds.y, left: ol.bounds.x });
    }

    // Subtitle Safe Area
    const { subtitleArea } = layout.calculateSafeSubtitleArea(videoPlan.overlays, videoPlan.canvas);
    if (subtitleArea) {
        console.log(`Subtitle Area -> x:${subtitleArea.x}, y:${subtitleArea.y}, w:${subtitleArea.width}, h:${subtitleArea.height}`);
        const subBox = Buffer.from(`<svg width="${vw}" height="${vh}"><rect x="${subtitleArea.x}" y="${subtitleArea.y}" width="${subtitleArea.width}" height="${subtitleArea.height}" fill="rgba(0,255,0,0.3)" stroke="green" stroke-width="2"/></svg>`);
        composites.push({ input: subBox, top: 0, left: 0 });
    }

    await sharp({ create: { width: vw, height: vh, channels: 4, background: '#000000' } })
        .composite(composites)
        .png()
        .toFile("min_layout_audit_video.png");
    console.log("Saved min_layout_audit_video.png");

    // 2. Audit Thumbnail Layout
    console.log("Auditing Thumbnail Layout...");
    const thumbPlan = await layout.createThumbnailRenderPlan();
    const tw = thumbPlan.canvas.width;
    const th = thumbPlan.canvas.height;

    const tComposites: sharp.OverlayOptions[] = [];
    tComposites.push({
        input: { create: { width: tw, height: th, channels: 4, background: '#FFE14A' } },
        top: 0, left: 0
    });

    for (const ol of thumbPlan.overlays) {
        console.log(`Thumb Overlay: ${path.basename(ol.resolvedPath)} -> x:${ol.bounds.x}, y:${ol.bounds.y}, w:${ol.bounds.width}, h:${ol.bounds.height}`);
        const box = Buffer.from(`<svg width="${ol.bounds.width}" height="${ol.bounds.height}"><rect x="0" y="0" width="${ol.bounds.width}" height="${ol.bounds.height}" fill="none" stroke="blue" stroke-width="5"/></svg>`);
        tComposites.push({ input: box, top: ol.bounds.y, left: ol.bounds.x });
        const img = await sharp(ol.resolvedPath).resize(ol.bounds.width, ol.bounds.height).toBuffer();
        tComposites.push({ input: img, top: ol.bounds.y, left: ol.bounds.x });
    }

    await sharp({ create: { width: tw, height: th, channels: 4, background: '#000000' } })
        .composite(tComposites)
        .png()
        .toFile("min_layout_audit_thumbnail.png");
    console.log("Saved min_layout_audit_thumbnail.png");
}

main().catch(console.error);
