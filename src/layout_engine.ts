import path from "path";
import fs from "fs-extra";
import sharp from "sharp";
import { loadConfig, resolvePath, fitText, wrapText } from "./core.js";
import { AppConfig, Rect, Size, OverlayConfig } from "./types.js";

export interface RenderPlan {
    canvas: Size;
    overlays: { config: OverlayConfig; resolvedPath: string; bounds: Rect; }[];
    subtitleArea?: Rect;
    safeMarginL?: number;
    safeMarginR?: number;
}

export class LayoutEngine {
    config: AppConfig;
    videoRes: Size;
    thumbRes: Size;

    constructor() {
        this.config = loadConfig();
        const videoCfg = this.config.steps.video;
        const thumbCfg = this.config.steps.thumbnail;
        const [vw, vh] = (videoCfg.resolution || "1920x1080").split("x").map(Number);
        this.videoRes = { width: vw, height: vh };
        const [tw, th] = (thumbCfg.resolution || "1280x720").split("x").map(Number);
        this.thumbRes = { width: tw, height: th };
    }

    async createVideoRenderPlan(): Promise<RenderPlan> {
        return this.createGenericPlan(this.config.steps.video.effects, this.videoRes, true);
    }

    async createThumbnailRenderPlan(): Promise<RenderPlan> {
        return this.createGenericPlan(this.config.steps.thumbnail.overlays, this.thumbRes, false);
    }

    private async createGenericPlan(items: OverlayConfig[], canvasSize: Size, calcSubtitles: boolean): Promise<RenderPlan> {
        const overlays = [];
        for (const e of items || []) {
            if ((e.type && e.type !== 'overlay') || !e.enabled || !e.image_path) continue;
            const imgPath = resolvePath(e.image_path);
            const meta = await sharp(imgPath).metadata();
            if (!meta.width || !meta.height) continue;

            const bounds = this.calculateBounds(e, { width: meta.width, height: meta.height }, canvasSize);
            overlays.push({ config: e, resolvedPath: imgPath, bounds });
        }

        let subResult: Partial<RenderPlan> = {};
        if (calcSubtitles) subResult = this.calculateSafeSubtitleArea(overlays, canvasSize);

        return { canvas: canvasSize, overlays, ...subResult };
    }

    private calculateTargetSize(config: OverlayConfig, originalSize: Size, canvas: Size): Size {
        const { width: W, height: H } = canvas;
        const { width: oW, height: oH } = originalSize;
        if (config.width) return { width: config.width, height: oH * (config.width / oW) };
        if (config.height) return { height: config.height, width: oW * (config.height / oH) };
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

    calculateBounds(config: OverlayConfig, originalSize: Size, canvasSize: Size): Rect {
        const target = this.calculateTargetSize(config, originalSize, canvasSize);
        const [tW, tH] = [Math.round(target.width), Math.round(target.height)];
        const { left: oL = 0, right: oR = 0, top: oT = 0, bottom: oB = 0 } = config.offset || {};
        const x = config.anchor?.includes("right") ? canvasSize.width - tW - oR : oL;
        const y = config.anchor?.includes("bottom") ? canvasSize.height - tH - oB : oT;
        return { x: Math.round(x), y: Math.round(y), width: tW, height: tH };
    }

    calculateSafeSubtitleArea(overlays: { bounds: Rect, config: OverlayConfig }[], canvas: Size): { subtitleArea: Rect, safeMarginL: number, safeMarginR: number } {
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
            subtitleArea: { x: sL, y: H - 300, width: W - sL - sR, height: 300 - (subCfg.margin_v || 10) },
            safeMarginL: Math.round(sL), safeMarginR: Math.round(sR)
        };
    }

    private calculateAutomaticMargins(overlays: { bounds: Rect }[], W: number, H: number) {
        let [sL, sR] = [0, 0];
        const zone = H * 0.15;
        for (const ol of overlays) {
            if (ol.bounds.y + ol.bounds.height <= H - zone) continue;
            if (ol.bounds.x < W / 2) sL = Math.max(sL, ol.bounds.x + ol.bounds.width + 10);
            else sR = Math.max(sR, W - ol.bounds.x + 10);
        }
        return { sL, sR };
    }


    generateASS(script: { lines: { text: string }[] }, durations: number[], plan: RenderPlan): string {
        const { safeMarginL: sL, safeMarginR: sR } = plan;
        const [w, h] = (this.config.steps.video.resolution || "1920x1080").split("x");
        const cfg = this.getSubtitlesStyle(sL, sR);
        const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${w}\nPlayResY: ${h}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${cfg.font},${cfg.size},${cfg.color},&H000000FF,${cfg.outlineColor},&H00000080,0,0,0,0,100,100,0,0,1,${cfg.outline},${cfg.shadow},${cfg.align},${cfg.mL},${cfg.mR},${cfg.mV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

        const maxW = Number(w) - (sL || 0) - (sR || 0);
        return header + this.generateASSDialogLines(script, durations, maxW, cfg.size);
    }

    private getSubtitlesStyle(sL: number = 0, sR: number = 0) {
        const s = this.config.steps.video.subtitles;
        return Object.assign(this.getSubtitleBaseStyle(s), this.getSubtitleAppearance(s, sL, sR));
    }

    private getSubtitleBaseStyle(subtitlesConfig: AppConfig["steps"]["video"]["subtitles"]) {
        const s = subtitlesConfig || {};
        const g = this.config.global_style;
        return {
            font: s.font_name || g.font_name,
            size: s.font_size || g.video.subtitle_size,
            color: s.primary_colour || '&HFFFFFF&',
            outlineColor: s.outline_colour || '&H000000&',
        };
    }

    private getSubtitleAppearance(subtitlesConfig: AppConfig["steps"]["video"]["subtitles"], sL: number, sR: number) {
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

    private generateASSDialogLines(script: { lines: { text: string }[] }, durations: number[], maxW: number, baseFz: number): string {
        let events = "", time = 0;
        const subCfg = this.config.steps.video.subtitles || {};
        const minFz = subCfg.min_font_size || 40;
        for (let i = 0; i < script.lines.length; i++) {
            const { formattedText: txt, fontSize: fz } = fitText(script.lines[i].text, baseFz, maxW, minFz);
            const content = fz !== baseFz ? `{\\fs${fz}}${txt}` : txt;
            events += `Dialogue: 0,${this.formatAssTime(time)},${this.formatAssTime(time + durations[i])},Default,,0,0,0,,${content.replace(/\n/g, "\\N")}\n`;
            time += durations[i];
        }
        return events;
    }

    private formatAssTime(s: number): string {
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60), ms = Math.floor((s % 1) * 100);
        return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
    }

    async renderThumbnail(plan: RenderPlan, title: string, output: string): Promise<void> {
        const cfg = this.config.steps.thumbnail;
        const palette = cfg.palettes?.[0];
        if (!palette) throw new Error("No palette");
        const backdrop = { create: { width: cfg.width, height: cfg.height, channels: 4 as const, background: palette.background_color } };
        const layers: sharp.OverlayOptions[] = [{ input: backdrop, top: 0, left: 0 }];

        for (const ol of plan.overlays) {
            layers.push({ input: await sharp(ol.resolvedPath).resize(ol.bounds.width, ol.bounds.height).toBuffer(), top: ol.bounds.y, left: ol.bounds.x });
        }

        const textMaxX = (plan.overlays.length ? Math.min(...plan.overlays.map(o => o.bounds.x)) : cfg.width) - 20;
        layers.push({ input: Buffer.from(this.createThumbnailSvg(title, textMaxX, cfg, palette)), top: 0, left: 0 });
        await sharp({ create: { width: cfg.width, height: cfg.height, channels: 4 as const, background: '#000' } }).composite(layers).png().toFile(output);
    }

    private createThumbnailSvg(title: string, maxX: number, cfg: AppConfig["steps"]["thumbnail"], pal: AppConfig["steps"]["thumbnail"]["palettes"][number]): string {
        const lines = title.split('\n').filter(l => l.trim());
        const g = this.config.global_style;
        const fz = cfg.title_font_size || g.thumbnail.title_size, lh = fz * 1.2;
        const startY = (cfg.height - lines.length * lh) / 2 + lh / 2;
        const txt = lines.map((l, i) => {
            const y = startY + i * lh, escaped = l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<text x="${cfg.padding || 40}" y="${y}" class="outline">${escaped}</text><text x="${cfg.padding || 40}" y="${y}" class="fill">${escaped}</text>`;
        }).join('');
        return `<svg width="${cfg.width}" height="${cfg.height}" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="s"><rect x="0" y="0" width="${maxX}" height="${cfg.height}"/></clipPath></defs><style>text { font-family: '${g.font_name}', sans-serif; font-size: ${fz}px; font-weight: bold; text-anchor: start; dominant-baseline: middle; } .outline { fill: none; stroke: ${pal.outline_outer_color || '#000'}; stroke-width: ${(pal.outline_outer_width || 15) * 2}px; } .fill { fill: ${pal.title_color || '#FFF'}; stroke: ${pal.outline_inner_color || '#FFF'}; stroke-width: ${pal.outline_inner_width || 5}px; paint-order: stroke fill; }</style><g clip-path="url(#s)">${txt}</g></svg>`;
    }
}
