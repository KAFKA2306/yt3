import sharp from "sharp";
import { fitText, loadConfig, resolvePath } from "./core.js";
import { ThumbnailRenderer } from "./thumbnail_renderer.js";
import type { AppConfig, OverlayConfig, Rect, Size } from "./types.js";
export interface RenderPlan {
	canvas: Size;
	overlays: { config: OverlayConfig; resolvedPath: string; bounds: Rect }[];
	subtitleArea?: Rect;
	safeMarginL?: number;
	safeMarginR?: number;
}
export class LayoutEngine {
	config: AppConfig;
	videoRes: Size;
	thumbRes: Size;
	thumbRenderer: ThumbnailRenderer;
	constructor() {
		this.config = loadConfig();
		this.thumbRenderer = new ThumbnailRenderer(this.config);
		const videoCfg = this.config.steps.video;
		const thumbCfg = this.config.steps.thumbnail;
		const vResParts = (videoCfg.resolution || "1920x1080")
			.split("x")
			.map(Number);
		this.videoRes = {
			width: vResParts[0] ?? 1920,
			height: vResParts[1] ?? 1080,
		};
		const tResParts = (thumbCfg.resolution || "1280x720")
			.split("x")
			.map(Number);
		this.thumbRes = {
			width: tResParts[0] ?? 1280,
			height: tResParts[1] ?? 720,
		};
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
		canvasSize: Size,
		calcSubtitles: boolean,
	): Promise<RenderPlan> {
		const overlays = [];
		for (const e of items || []) {
			if ((e.type && e.type !== "overlay") || !e.enabled || !e.image_path)
				continue;
			const imgPath = resolvePath(e.image_path);
			const meta = await sharp(imgPath).metadata();
			if (!meta.width || !meta.height) continue;
			const bounds = this.calculateBounds(
				e,
				{ width: meta.width, height: meta.height },
				canvasSize,
			);
			overlays.push({ config: e, resolvedPath: imgPath, bounds });
		}
		let subResult: Partial<RenderPlan> = {};
		if (calcSubtitles)
			subResult = this.calculateSafeSubtitleArea(overlays, canvasSize);
		return { canvas: canvasSize, overlays, ...subResult };
	}
	private calculateTargetSize(
		config: OverlayConfig,
		originalSize: Size,
		canvas: Size,
	): Size {
		const { width: W, height: H } = canvas;
		const { width: oW, height: oH } = originalSize;
		if (config.width)
			return { width: config.width, height: oH * (config.width / oW) };
		if (config.height)
			return { height: config.height, width: oW * (config.height / oH) };
		if (config.height_ratio) {
			const h = H * config.height_ratio;
			return { height: h, width: oW * (h / oH) };
		}
		if (config.width_ratio) {
			const w = W * config.width_ratio;
			return { width: w, height: oH * (w / oW) };
		}
		return originalSize;
	}
	calculateBounds(
		config: OverlayConfig,
		originalSize: Size,
		canvasSize: Size,
	): Rect {
		const target = this.calculateTargetSize(config, originalSize, canvasSize);
		const [tW, tH] = [Math.round(target.width), Math.round(target.height)];
		const {
			left: oL = 0,
			right: oR = 0,
			top: oT = 0,
			bottom: oB = 0,
		} = config.offset || {};
		const x = config.anchor?.includes("right")
			? canvasSize.width - tW - oR
			: oL;
		const y = config.anchor?.includes("bottom")
			? canvasSize.height - tH - oB
			: oT;
		return { x: Math.round(x), y: Math.round(y), width: tW, height: tH };
	}
	calculateSafeSubtitleArea(
		overlays: { bounds: Rect; config: OverlayConfig }[],
		canvas: Size,
	): { subtitleArea: Rect; safeMarginL: number; safeMarginR: number } {
		const { width: W, height: H } = canvas;
		const subCfg = this.config.steps.video.subtitles || {};
		let [sL, sR] = [subCfg.margin_l || 0, subCfg.margin_r || 0];
		if (sL === 0 && sR === 0) {
			const result = this.calculateAutomaticMargins(overlays, W, H);
			sL = result.sL;
			sR = result.sR;
		}
		const minW = W * 0.5;
		if (W - sL - sR < minW) {
			const excess = (minW - (W - sL - sR)) / 2;
			sL = Math.max(0, sL - excess);
			sR = Math.max(0, sR - excess);
		}
		return {
			subtitleArea: {
				x: sL,
				y: H - 300,
				width: W - sL - sR,
				height: 300 - (subCfg.margin_v || 10),
			},
			safeMarginL: Math.round(sL),
			safeMarginR: Math.round(sR),
		};
	}
	private calculateAutomaticMargins(
		overlays: { bounds: Rect }[],
		W: number,
		H: number,
	) {
		let [sL, sR] = [0, 0];
		const zone = H * 0.15;
		for (const ol of overlays) {
			if (ol.bounds.y + ol.bounds.height <= H - zone) continue;
			if (ol.bounds.x < W / 2)
				sL = Math.max(sL, ol.bounds.x + ol.bounds.width + 10);
			else sR = Math.max(sR, W - ol.bounds.x + 10);
		}
		return { sL, sR };
	}
	generateASS(
		script: { lines: { text: string }[] },
		durations: number[],
		plan: RenderPlan,
	): string {
		const { safeMarginL: sL, safeMarginR: sR } = plan;
		const [w, h] = (this.config.steps.video.resolution || "1920x1080").split(
			"x",
		);
		const cfg = this.getSubtitlesStyle(sL, sR);
		const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w ?? "1920"}\nPlayResY: ${h ?? "1080"}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${cfg.font},${cfg.size},${cfg.color},&H000000FF,${cfg.outlineColor},&H00000080,0,0,0,0,100,100,0,0,1,${cfg.outline},${cfg.shadow},${cfg.align},${cfg.mL},${cfg.mR},${cfg.mV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
		const maxW = Number(w ?? "1920") - (sL || 0) - (sR || 0);
		return (
			header + this.generateASSDialogLines(script, durations, maxW, cfg.size)
		);
	}
	private getSubtitlesStyle(sL = 0, sR = 0) {
		const s = this.config.steps.video.subtitles;
		return Object.assign(
			this.getSubtitleBaseStyle(s),
			this.getSubtitleAppearance(s, sL, sR),
		);
	}
	private getSubtitleBaseStyle(
		subtitlesConfig: AppConfig["steps"]["video"]["subtitles"],
	) {
		const s = subtitlesConfig || {};
		const g = this.config.global_style;
		const tokens = this.config.design_tokens;
		return {
			font:
				s.font_name ||
				`${tokens?.font_text || "Atkinson Hyperlegible"}, IBM Plex Sans JP`,
			size: s.font_size || g.video.subtitle_size,
			color: s.primary_colour || "&HFFFFFF&",
			outlineColor: s.outline_colour || "&H000000&",
		};
	}
	private getSubtitleAppearance(
		subtitlesConfig: AppConfig["steps"]["video"]["subtitles"],
		sL: number,
		sR: number,
	) {
		const s = subtitlesConfig || {};
		return {
			outline: s.outline === undefined ? 2 : s.outline,
			shadow: s.shadow === undefined ? 0 : s.shadow,
			align: s.alignment === undefined ? 2 : s.alignment,
			mV: s.margin_v === undefined ? 10 : s.margin_v,
			mL: sL,
			mR: sR,
		};
	}
	private generateASSDialogLines(
		script: { lines: { text: string }[] },
		durations: number[],
		maxW: number,
		baseFz: number,
	): string {
		let events = "";
		let time = 0;
		const subCfg = this.config.steps.video.subtitles || {};
		const minFz = subCfg.min_font_size || 40;
		for (let i = 0; i < script.lines.length; i++) {
			const line = script.lines[i];
			if (!line) continue;
			const duration = durations[i] ?? 0;
			const { formattedText: txt, fontSize: fz } = fitText(
				line.text,
				baseFz,
				maxW,
				minFz,
			);
			const content = fz !== baseFz ? `{\\fs${fz}}${txt}` : txt;
			events += `Dialogue: 0,${this.formatAssTime(time)},${this.formatAssTime(time + duration)},Default,,0,0,0,,${content.replace(/\n/g, "\\N")}\n`;
			time += duration;
		}
		return events;
	}
	private formatAssTime(s: number): string {
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		const sec = Math.floor(s % 60);
		const ms = Math.floor((s % 1) * 100);
		return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
	}
	async renderThumbnail(
		plan: RenderPlan,
		title: string,
		output: string,
	): Promise<void> {
		await this.thumbRenderer.render(plan, title, output);
	}
}
