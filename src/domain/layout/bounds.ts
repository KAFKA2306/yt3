import type { OverlayConfig, Rect, Size } from "../config/base.js";

export function calculateBounds(
	config: OverlayConfig,
	original: Size,
	canvas: Size,
): Rect {
	const [origW, origH] = [original.width, original.height];
	const [canW, canH] = [canvas.width, canvas.height];

	// 1. Calculate Size
	let w = config.size?.width ?? config.width;
	let h = config.size?.height ?? config.height;

	if (config.height_ratio !== undefined) {
		h = canH * config.height_ratio;
		if (w === undefined) {
			w = h * (origW / origH);
		}
	} else if (config.width_ratio !== undefined) {
		w = canW * config.width_ratio;
		if (h === undefined) {
			h = w * (origH / origW);
		}
	}

	if (w === undefined && h === undefined) {
		const scaling = config.scaling || "fit";
		if (scaling === "fill") {
			w = canW;
			h = canH;
		} else if (scaling === "fit") {
			const ratio = Math.min(canW / origW, canH / origH);
			w = origW * ratio;
			h = origH * ratio;
		} else if (scaling === "stretch") {
			w = canW;
			h = canH;
		} else {
			w = origW;
			h = origH;
		}
	} else if (w === undefined && h !== undefined) {
		w = h * (origW / origH);
	} else if (w !== undefined && h === undefined) {
		h = w * (origH / origW);
	}

	if (w === undefined || h === undefined) {
		throw new Error("calculateBounds: size could not be determined");
	}

	// 2. Calculate Position
	let x = config.position?.x ?? 0;
	let y = config.position?.y ?? 0;

	if (config.anchor) {
		const offset = config.offset || {};
		const t = offset.top ?? 0;
		const b = offset.bottom ?? 0;
		const l = offset.left ?? 0;
		const r = offset.right ?? 0;

		switch (config.anchor) {
			case "top_left":
				x = l;
				y = t;
				break;
			case "top_right":
				x = canW - w - r;
				y = t;
				break;
			case "bottom_left":
				x = l;
				y = canH - h - b;
				break;
			case "bottom_right":
				x = canW - w - r;
				y = canH - h - b;
				break;
			case "center":
				x = (canW - w) / 2 + l - r;
				y = (canH - h) / 2 + t - b;
				break;
			case "top_center":
				x = (canW - w) / 2 + l - r;
				y = t;
				break;
			case "bottom_center":
				x = (canW - w) / 2 + l - r;
				y = canH - h - b;
				break;
			case "left_center":
				x = l;
				y = (canH - h) / 2 + t - b;
				break;
			case "right_center":
				x = canW - w - r;
				y = (canH - h) / 2 + t - b;
				break;
		}
	} else {
		const scaling = config.scaling || "fit";
		if (config.position === undefined) {
			if (scaling === "fit") {
				x = (canW - w) / 2;
				y = (canH - h) / 2;
			} else if (scaling === "fill" || scaling === "stretch") {
				x = 0;
				y = 0;
			}
		}
	}

	return { x, y, width: w, height: h };
}
