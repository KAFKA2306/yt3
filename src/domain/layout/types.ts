import type { OverlayConfig, Rect, Size } from "../config/base.js";

export interface RenderPlan {
	canvas: Size;
	overlays: { config: OverlayConfig; resolvedPath: string; bounds: Rect }[];
	subtitleArea?: Rect;
	safeMarginL?: number;
	safeMarginR?: number;
}
