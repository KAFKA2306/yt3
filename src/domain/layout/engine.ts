import sharp from "sharp";
import { loadConfig, resolvePath } from "../../io/core.js";
import type { OverlayConfig, Rect, Size } from "../config/base.js";
import { ThumbnailRenderer } from "../thumbnail_renderer.js";
import type { AppConfig, RenderPlan, Script } from "../types.js";
import { generateASS } from "./ass.js";
import { calculateBounds } from "./bounds.js";

export class LayoutEngine {
	config: AppConfig;
	videoRes: Size;
	thumbRes: Size;
	thumbRenderer: ThumbnailRenderer;

	constructor() {
		this.config = loadConfig();
		this.thumbRenderer = new ThumbnailRenderer(this.config);
		const parseRes = (s: string) => s.split("x").map(Number);
		const v = parseRes(this.config.steps.video.resolution || "1920x1080");
		this.videoRes = { width: v[0] ?? 1920, height: v[1] ?? 1080 };
		const t = parseRes(this.config.steps.thumbnail.resolution || "1280x720");
		this.thumbRes = { width: t[0] ?? 1280, height: t[1] ?? 720 };
	}

	async createVideoRenderPlan(): Promise<RenderPlan> {
		return this.createGenericPlan(
			this.config.steps.video.effects,
			this.videoRes,
			true,
		);
	}

	async createThumbnailRenderPlan(): Promise<RenderPlan> {
		return this.createGenericPlan(
			this.config.steps.thumbnail.overlays,
			this.thumbRes,
			false,
		);
	}

	private async createGenericPlan(
		items: OverlayConfig[],
		canvas: Size,
		calcSub: boolean,
	): Promise<RenderPlan> {
		const overlays = [];
		for (const e of items || []) {
			if (e.type === "overlay" || (!e.type && e.enabled && e.image_path)) {
				const p = resolvePath(e.image_path);
				const m = await sharp(p).metadata();
				if (m.width && m.height) {
					overlays.push({
						config: e,
						resolvedPath: p,
						bounds: calculateBounds(
							e,
							{ width: m.width, height: m.height },
							canvas,
						),
					});
				}
			}
		}
		return {
			canvas,
			overlays,
			...(calcSub ? this.calculateSafeSubtitleArea(overlays, canvas) : {}),
		};
	}

	private calculateSafeSubtitleArea(
		overlays: Array<{ bounds: Rect }>,
		canvas: Size,
	) {
		const { width: W, height: H } = canvas;
		const s = this.config.steps.video.subtitles || {};
		let [sL, sR] = [s.margin_l || 0, s.margin_r || 0];
		const lc = this.config.steps.video.layout_constants || {
			subtitle_zone_ratio: 0.15,
			subtitle_height: 300,
			default_max_w_ratio: 0.5,
		};

		if (sL === 0 && sR === 0) {
			const zone = H * lc.subtitle_zone_ratio;
			for (const ol of overlays) {
				if (ol.bounds.y + ol.bounds.height > H - zone) {
					if (ol.bounds.x < W / 2)
						sL = Math.max(sL, ol.bounds.x + ol.bounds.width + 10);
					else sR = Math.max(sR, W - ol.bounds.x + 10);
				}
			}
		}
		const minW = W * (lc.default_max_w_ratio ?? 0.5);
		if (W - sL - sR < minW) {
			const ex = (minW - (W - sL - sR)) / 2;
			sL = Math.max(0, sL - ex);
			sR = Math.max(0, sR - ex);
		}
		const h = lc.subtitle_height ?? 300;
		return {
			subtitleArea: {
				x: sL,
				y: H - h,
				width: W - sL - sR,
				height: h - (s.margin_v || 10),
			},
			safeMarginL: Math.round(sL),
			safeMarginR: Math.round(sR),
		};
	}

	generateASS(script: Script, durations: number[], plan: RenderPlan): string {
		return generateASS(script, durations, plan, this.config);
	}

	async renderThumbnail(plan: RenderPlan, title: string, output: string) {
		await this.thumbRenderer.render(plan, title, output);
	}

	async renderDebugVisuals(plan: RenderPlan, output: string) {
		const canvas = sharp({
			create: {
				width: plan.canvas.width,
				height: plan.canvas.height,
				channels: 4,
				background: { r: 30, g: 30, b: 30, alpha: 1 },
			},
		});
		const svg = `<svg width="${plan.canvas.width}" height="${plan.canvas.height}">
			${plan.overlays.map((o: { bounds: Rect }) => `<rect x="${o.bounds.x}" y="${o.bounds.y}" width="${o.bounds.width}" height="${o.bounds.height}" fill="none" stroke="red" stroke-width="2"/>`).join("")}
			${plan.subtitleArea ? `<rect x="${plan.subtitleArea.x}" y="${plan.subtitleArea.y}" width="${plan.subtitleArea.width}" height="${plan.subtitleArea.height}" fill="none" stroke="green" stroke-width="2"/>` : ""}
		</svg>`;
		await canvas
			.composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
			.toFile(output);
	}
}
