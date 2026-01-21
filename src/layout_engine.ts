import path from "path";
import fs from "fs-extra";
import sharp from "sharp";
import { loadConfig, resolvePath } from "./core.js";
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
        const [vw, vh] = ((this.config.steps.video?.resolution || "1920x1080")).split("x").map(Number);
        this.videoRes = { width: vw, height: vh };
        const [tw, th] = ((this.config.steps.thumbnail?.resolution || "1280x720") as string).split("x").map(Number);
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

    calculateBounds(config: OverlayConfig, originalSize: Size, canvasSize: Size): Rect {
        const W = canvasSize.width;
        const H = canvasSize.height;
        let targetW = 0, targetH = 0;

        if (config.width) {
            targetW = config.width;
            targetH = originalSize.height * (targetW / originalSize.width);
        } else if (config.height) {
            targetH = config.height;
            targetW = originalSize.width * (targetH / originalSize.height);
        } else if (config.height_ratio) {
            targetH = H * config.height_ratio;
            targetW = originalSize.width * (targetH / originalSize.height);
        } else if (config.width_ratio) {
            targetW = W * config.width_ratio;
            targetH = originalSize.height * (targetW / originalSize.width);
        } else {
            targetW = originalSize.width;
            targetH = originalSize.height;
        }

        targetW = Math.round(targetW);
        targetH = Math.round(targetH);

        let x = 0, y = 0;
        const offL = config.offset?.left || 0, offR = config.offset?.right || 0, offT = config.offset?.top || 0, offB = config.offset?.bottom || 0;

        if (config.anchor?.includes("right")) x = W - targetW - offR;
        else x = offL;

        if (config.anchor?.includes("bottom")) y = H - targetH - offB;
        else y = offT;

        return { x: Math.round(x), y: Math.round(y), width: targetW, height: targetH };
    }

    calculateSafeSubtitleArea(overlays: { bounds: Rect, config: OverlayConfig }[], canvasSize: Size): { subtitleArea: Rect, safeMarginL: number, safeMarginR: number } {
        const W = canvasSize.width, H = canvasSize.height;
        const subConfig = this.config.steps.video.subtitles || {};

        let safeL = subConfig.margin_l || 0;
        let safeR = subConfig.margin_r || 0;

        if (safeL === 0 && safeR === 0) {
            const subtitleZone = H * 0.15;
            for (const ol of overlays) {
                const overlayBottom = ol.bounds.y + ol.bounds.height;
                if (overlayBottom <= H - subtitleZone) continue;
                const isLeft = ol.bounds.x < W / 2;
                if (isLeft) safeL = Math.max(safeL, ol.bounds.x + ol.bounds.width + 10);
                else safeR = Math.max(safeR, W - ol.bounds.x + 10);
            }
        }

        const minWidth = W * 0.5;
        if (W - safeL - safeR < minWidth) {
            const excess = minWidth - (W - safeL - safeR);
            safeL = Math.max(0, safeL - excess / 2);
            safeR = Math.max(0, safeR - excess / 2);
        }

        return {
            subtitleArea: { x: safeL, y: H - 300, width: W - safeL - safeR, height: 300 - (subConfig.margin_v || 10) },
            safeMarginL: Math.round(safeL),
            safeMarginR: Math.round(safeR)
        };
    }

    fitText(text: string, baseFontSize: number, maxWidthPixels: number): { formattedText: string, fontSize: number } {
        const subConfig = this.config.steps.video.subtitles || {};
        const charWidth = baseFontSize;
        const safeChars = Math.floor(maxWidthPixels / charWidth);
        const isTooLong = text.length > safeChars * 2;
        const targetSize = isTooLong ? (subConfig.min_font_size || 40) : baseFontSize;
        const targetSafeChars = isTooLong ? Math.floor(maxWidthPixels / targetSize) : safeChars;

        return { formattedText: this.wrapText(text, targetSafeChars), fontSize: targetSize };
    }

    private wrapText(text: string, maxChars: number): string {
        let p = 0, res = "";
        while (p < text.length) {
            res += text.substring(p, p + maxChars) + "\n";
            p += maxChars;
        }
        return res.trim();
    }

    generateASS(script: { lines: { text: string }[] }, durations: number[], videoPlan: RenderPlan): string {
        const { safeMarginL, safeMarginR } = videoPlan;
        const [w, h] = (this.config.steps.video?.resolution || "1920x1080").split("x");
        const cfg = this.config.steps.video?.subtitles || {};

        const assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${cfg.font_name || 'Arial'},${cfg.font_size || 72},${cfg.primary_colour || '&HFFFFFF&'},&H000000FF,${cfg.outline_colour || '&H000000&'},&H00000080,0,0,0,0,100,100,0,0,1,${cfg.outline || 2},${cfg.shadow || 0},${cfg.alignment || 2},${safeMarginL || 0},${safeMarginR || 0},${cfg.margin_v || 10},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

        const safeWidthPixels = (Number(w) - (safeMarginL || 0) - (safeMarginR || 0));
        let assEvents = "", currentTime = 0;

        for (let i = 0; i < script.lines.length; i++) {
            const duration = durations[i];
            const startTime = this.formatAssTime(currentTime);
            const endTime = this.formatAssTime(currentTime + duration);
            const { formattedText, fontSize: fitSize } = this.fitText(script.lines[i].text, cfg.font_size || 72, safeWidthPixels);
            const textContent = fitSize !== (cfg.font_size || 72) ? `{\\fs${fitSize}}${formattedText}` : formattedText;
            assEvents += `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${textContent.replace(/\n/g, "\\N")}\n`;
            currentTime += duration;
        }
        return assHeader + assEvents;
    }

    private formatAssTime(s: number): string {
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60), ms = Math.floor((s % 1) * 100);
        return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
    }

    async renderThumbnail(plan: RenderPlan, title: string, outputFile: string): Promise<void> {
        const thumbCfg = this.config.steps.thumbnail;
        const { width, height, title_font_size, palettes, padding, right_guard_band_px } = thumbCfg;
        if (!palettes || palettes.length === 0) throw new Error("No palettes defined in config");
        const palette = palettes[0];
        const composites: sharp.OverlayOptions[] = [];

        composites.push({ input: { create: { width, height, channels: 4, background: palette.background_color } }, top: 0, left: 0 });

        for (const ol of plan.overlays) {
            const buf = await sharp(ol.resolvedPath).resize(ol.bounds.width, ol.bounds.height).toBuffer();
            composites.push({ input: buf, top: ol.bounds.y, left: ol.bounds.x });
        }

        const leftPad = padding || 40;
        const minOverlayX = plan.overlays.length > 0 ? Math.min(...plan.overlays.map(ol => ol.bounds.x)) : width;
        const textMaxX = minOverlayX - 20;
        const textX = leftPad;
        const lines = title.split('\n').filter(l => l.trim());
        const lineHeight = (title_font_size || 120) * 1.2;
        const totalTextHeight = lines.length * lineHeight;
        const startY = (height - totalTextHeight) / 2 + lineHeight / 2;

        let textElements = '';
        for (let i = 0; i < lines.length; i++) {
            const y = startY + i * lineHeight;
            const escaped = lines[i].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            textElements += `<text x="${textX}" y="${y}" class="outline">${escaped}</text>`;
            textElements += `<text x="${textX}" y="${y}" class="fill">${escaped}</text>`;
        }

        const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
<defs><clipPath id="safe"><rect x="0" y="0" width="${textMaxX}" height="${height}"/></clipPath></defs>
<style>
text { font-family: sans-serif; font-size: ${title_font_size || 120}px; font-weight: bold; text-anchor: start; dominant-baseline: middle; }
.outline { fill: none; stroke: ${palette.outline_outer_color || '#000'}; stroke-width: ${(palette.outline_outer_width || 15) * 2}px; }
.fill { fill: ${palette.title_color || '#FFF'}; stroke: ${palette.outline_inner_color || '#FFF'}; stroke-width: ${palette.outline_inner_width || 5}px; paint-order: stroke fill; }
</style>
<g clip-path="url(#safe)">${textElements}</g>
</svg>`;
        composites.push({ input: Buffer.from(svg), top: 0, left: 0 });

        await sharp({ create: { width, height, channels: 4, background: '#000000' } }).composite(composites).png().toFile(outputFile);
    }
}
