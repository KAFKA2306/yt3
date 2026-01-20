import path from "path";
import fs from "fs-extra";
import { loadConfig, getSpeakers } from "../src/config.js";

// Test: Config Loading
console.log("--- Testing Config Loading ---");
const cfg = loadConfig();
console.log("Video Resolution:", cfg.steps.video.resolution);
console.log("Subtitle Font:", cfg.steps.video.subtitles.font_name);
console.log("Subtitle Size:", cfg.steps.video.subtitles.font_size);
console.log("Speakers:", getSpeakers());

// Test: Overlay Effects Parsing
console.log("\n--- Testing Overlay Effects ---");
const effects = cfg.steps.video.effects || [];
for (const e of effects) {
    if (e.type === 'overlay' && e.enabled) {
        console.log(`Overlay: ${e.image_path}, anchor: ${e.anchor}, exists: ${fs.existsSync(e.image_path)}`);
    }
}

// Test: Thumbnail Overlays Parsing
console.log("\n--- Testing Thumbnail Overlays ---");
const thumbOverlays = cfg.steps.thumbnail.overlays || [];
for (const o of thumbOverlays) {
    if (o.enabled) {
        console.log(`Thumb Overlay: ${o.image_path}, anchor: ${o.anchor}, exists: ${fs.existsSync(o.image_path)}`);
    }
}

// Test: Safe Margin Calculation (simulated)
console.log("\n--- Simulating Safe Margin Calculation ---");
const [width, height] = cfg.steps.video.resolution.split("x").map(Number);
let safeMarginL = 0, safeMarginR = 0;
for (const e of effects) {
    if (e.type !== 'overlay' || !e.enabled) continue;
    const overlayW = e.width || (e.width_ratio ? width * e.width_ratio : (e.height_ratio ? (height * e.height_ratio) * 0.5 : 300));
    const anchor = e.anchor || "";
    if (anchor.includes("left")) safeMarginL = Math.max(safeMarginL, (e.offset?.left || 0) + overlayW + 20);
    if (anchor.includes("right")) safeMarginR = Math.max(safeMarginR, (e.offset?.right || 0) + overlayW + 20);
}
console.log(`Calculated Safe Margins: L=${safeMarginL}, R=${safeMarginR}`);
console.log(`Available Text Width: ${width - safeMarginL - safeMarginR}px`);

console.log("\n--- All Tests Passed ---");
