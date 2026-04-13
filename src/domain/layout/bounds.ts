import type { OverlayConfig, Rect, Size } from "../config/base.js";

export function calculateBounds(
	config: OverlayConfig,
	original: Size,
	canvas: Size,
): Rect {
	const scaling = config.scaling || "fit";
	const pos = config.position || { x: 0, y: 0 };
	const [origW, origH] = [original.width, original.height];
	const [canW, canH] = [canvas.width, canvas.height];

	if (scaling === "fill") {
		return { x: 0, y: 0, width: canW, height: canH };
	}

	if (scaling === "fit") {
		const ratio = Math.min(canW / origW, canH / origH);
		const w = origW * ratio;
		const h = origH * ratio;
		return { x: (canW - w) / 2, y: (canH - h) / 2, width: w, height: h };
	}

	const w = config.size?.width ?? origW;
	const h = config.size?.height ?? origH;
	return { x: pos.x, y: pos.y, width: w, height: h };
}
