import path from "node:path";
import fs from "fs-extra";
import sharp from "sharp";
import { loadConfig } from "../../core.js";
import { LayoutEngine } from "../../layout_engine.js";
async function main() {
	console.log("Starting Layout Audit...");
	const layout = new LayoutEngine();
	console.log("Auditing Video Layout...");
	const videoPlan = await layout.createVideoRenderPlan();
	await layout.renderDebugVisuals(videoPlan, "min_layout_audit_video.png");
	console.log("Saved min_layout_audit_video.png");
	console.log("Auditing Thumbnail Layout...");
	const thumbPlan = await layout.createThumbnailRenderPlan();
	await layout.renderDebugVisuals(thumbPlan, "min_layout_audit_thumbnail.png");
	console.log("Saved min_layout_audit_thumbnail.png");
}
main().catch(console.error);
