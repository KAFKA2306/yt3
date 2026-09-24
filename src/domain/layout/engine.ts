import sharp from "sharp";
import { loadConfig, resolvePath } from "../../io/core.js";
import type { OverlayConfig, Rect, Size } from "../config/base.js";
import { getKafkaVisualSystem } from "../design/kafka_visual_system.js";
import { ThumbnailRenderer } from "../media/thumbnail_renderer.js";
import type { AppConfig, RenderPlan, Script } from "../types.js";
import { generateASS } from "./ass.js";
import { calculateBounds } from "./bounds.js";

export class LayoutEngine {
	config: AppConfig;
	videoRes: Size;
	thumbRes: Size;
	thumbRenderer: ThumbnailRenderer;

	constructor(config?: AppConfig) {
		this.config = config || loadConfig();
		this.thumbRenderer = new ThumbnailRenderer(this.config);
		const design = getKafkaVisualSystem();
		this.videoRes = design.canvas.landscape;
		this.thumbRes = design.canvas.thumbnail;
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
		_overlays: Array<{ bounds: Rect }>,
		canvas: Size,
	) {
		const design = getKafkaVisualSystem();
		const s = design.landscape.subtitle;
		const sL = s.margin_left;
		const sR = s.margin_right;
		const h = design.landscape.caption_band.height;
		return {
			subtitleArea: {
				x: sL,
				y: design.landscape.caption_band.y,
				width: canvas.width - sL - sR,
				height: h,
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
