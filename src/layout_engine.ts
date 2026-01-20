import path from "path";
import fs from "fs-extra";
import sharp from "sharp";
import { loadConfig, resolvePath, ROOT } from "./core.js";

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Size {
    width: number;
    height: number;
}

export interface OverlayConfig {
    type: string;
    enabled: boolean;
    image_path: string;
    anchor?: string; // "top-left", "bottom-right", etc.
    offset?: { top?: number; bottom?: number; left?: number; right?: number };
    width?: number; // Valid if specific width
    height?: number;
    height_ratio?: number; // Valid if relative to canvas height
    width_ratio?: number;
}

export interface RenderPlan {
    canvas: Size;
    overlays: {
        config: OverlayConfig;
        resolvedPath: string;
        bounds: Rect;
    }[];
    subtitleArea?: Rect;
    safeMarginL?: number; // Only for video
    safeMarginR?: number;
}

export class LayoutEngine {
    config: any;
    videoRes: Size;
    thumbRes: Size;

    constructor() {
        this.config = loadConfig();
        const [vw, vh] = this.config.steps.video.resolution.split("x").map(Number);
        this.videoRes = { width: vw, height: vh };
        const [tw, th] = (this.config.steps.thumbnail?.resolution || "1280x720").split("x").map(Number);
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
            if (!fs.existsSync(imgPath)) continue;

            const meta = await sharp(imgPath).metadata();
            if (!meta.width || !meta.height) continue;

            const bounds = this.calculateBounds(e, { width: meta.width, height: meta.height }, canvasSize);
            overlays.push({ config: e, resolvedPath: imgPath, bounds });
        }

        let subResult = {};
        if (calcSubtitles) {
            subResult = this.calculateSafeSubtitleArea(overlays, canvasSize);
        }

        return {
            canvas: canvasSize,
            overlays,
            ...subResult
        };
    }

    calculateBounds(config: OverlayConfig, originalSize: Size, canvasSize: Size): Rect {
        const W = canvasSize.width;
        const H = canvasSize.height;

        // Calculate target dimensions
        let targetW = 0;
        let targetH = 0;

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
            // Default fallback if nothing specified? Or assume original size?
            // Current media.ts logic fallback was hardcoded 300px width for some reason if I recall, but let's default to scale=1 if nothing else
            targetW = originalSize.width;
            targetH = originalSize.height;
        }

        targetW = Math.round(targetW);
        targetH = Math.round(targetH);

        // Calculate Position
        let x = 0;
        let y = 0;

        const offL = config.offset?.left || 0;
        const offR = config.offset?.right || 0;
        const offT = config.offset?.top || 0;
        const offB = config.offset?.bottom || 0;

        // "anchor" string parsing simply
        // Default is top-left

        if (config.anchor?.includes("right")) {
            x = W - targetW - offR;
        } else {
            // left or default
            x = offL;
        }

        if (config.anchor?.includes("bottom")) {
            y = H - targetH - offB;
        } else {
            // top or default
            y = offT;
        }

        return { x: Math.round(x), y: Math.round(y), width: targetW, height: targetH };
    }

    calculateSafeSubtitleArea(overlays: { bounds: Rect, config: OverlayConfig }[], canvasSize: Size): { subtitleArea: Rect, safeMarginL: number, safeMarginR: number } {
        const W = canvasSize.width;
        const H = canvasSize.height;
        const subConfig = this.config.steps.video.subtitles || {};

        let safeL = subConfig.margin_l || 0;
        let safeR = subConfig.margin_r || 0;

        for (const ol of overlays) {
            const isLeft = ol.bounds.x < W / 2;
            const isBottom = ol.bounds.y + ol.bounds.height > H * 0.7;

            if (isBottom) {
                if (isLeft) safeL = Math.max(safeL, ol.bounds.x + ol.bounds.width + 20);
                else safeR = Math.max(safeR, W - ol.bounds.x + 20);
            }
        }

        const minWidth = W * 0.3;
        if (W - safeL - safeR < minWidth) {
            const needed = minWidth - (W - safeL - safeR);
            safeL = Math.max(0, safeL - needed / 2);
            safeR = Math.max(0, safeR - needed / 2);
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

        return {
            formattedText: this.wrapText(text, targetSafeChars),
            fontSize: targetSize
        };
    }

    private wrapText(text: string, maxChars: number): string {
        let p = 0;
        let res = "";
        while (p < text.length) {
            res += text.substring(p, p + maxChars) + "\n";
            p += maxChars;
        }
        return res.trim();
    }
    generateASS(script: { lines: { text: string }[] }, durations: number[], videoPlan: RenderPlan): string {
        const { safeMarginL, safeMarginR } = videoPlan;
        const [w, h] = this.config.steps.video.resolution.split("x");
        const fontName = this.config.steps.video.subtitles?.font_name || 'Arial';
        const fontSize = this.config.steps.video.subtitles?.font_size || 72;
        const primaryColor = this.config.steps.video.subtitles?.primary_colour || '&HFFFFFF&';
        const outlineColor = this.config.steps.video.subtitles?.outline_colour || '&H000000&';
        const outline = this.config.steps.video.subtitles?.outline || 2;
        const shadow = this.config.steps.video.subtitles?.shadow || 0;
        const alignment = this.config.steps.video.subtitles?.alignment || 2;
        const marginV = this.config.steps.video.subtitles?.margin_v || 10;

        const assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: ${w}
PlayResY: ${h}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${primaryColor},&H000000FF,${outlineColor},&H00000080,0,0,0,0,100,100,0,0,1,${outline},${shadow},${alignment},${safeMarginL},${safeMarginR},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

        const safeWidthPixels = (1920 - (safeMarginL || 0) - (safeMarginR || 0));
        let assEvents = "";
        let currentTime = 0;

        for (let i = 0; i < script.lines.length; i++) {
            const duration = durations[i];
            const startTime = this.formatAssTime(currentTime);
            const endTime = this.formatAssTime(currentTime + duration);

            const { formattedText, fontSize: fitSize } = this.fitText(script.lines[i].text, fontSize, safeWidthPixels);

            const textContent = fitSize !== fontSize
                ? `{\\fs${fitSize}}${formattedText}`
                : formattedText;

            assEvents += `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${textContent.replace(/\n/g, "\\N")}\n`;
            currentTime += duration;
        }

        return assHeader + assEvents;
    }

    private formatAssTime(s: number): string {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        const ms = Math.floor((s % 1) * 100);
        return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
    }

    async renderThumbnail(plan: RenderPlan, title: string, outputFile: string): Promise<void> {
        const { width, height, title_font_size, palettes } = this.config.steps.thumbnail;
        const palette = palettes[0];
        const composites: sharp.OverlayOptions[] = [];

        // Background
        composites.push({
            input: { create: { width, height, channels: 4, background: palette.background_color } },
            top: 0, left: 0
        });

        // Overlays
        for (const ol of plan.overlays) {
            const buf = await sharp(ol.resolvedPath).resize(ol.bounds.width, ol.bounds.height).toBuffer();
            composites.push({ input: buf, top: ol.bounds.y, left: ol.bounds.x });
        }

        // Title text
        const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><style>.t{font-family:sans-serif;font-size:${title_font_size}px;font-weight:bold;fill:${palette.title_color};stroke:${palette.outline_outer_color};stroke-width:${palette.outline_outer_width}px;paint-order:stroke fill}</style><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" class="t">${title}</text></svg>`;
        composites.push({ input: Buffer.from(svg), top: 0, left: 0 });

        await sharp({ create: { width, height, channels: 4, background: '#000000' } }) // Base canvas (ignored by bg overlay but good practice)
            .composite(composites)
            .png()
            .toFile(outputFile);
    }

    async renderDebugVisuals(plan: RenderPlan, outputFile: string): Promise<void> {
        const w = plan.canvas.width;
        const h = plan.canvas.height;
        const composites: sharp.OverlayOptions[] = [];

        // Background (Generic Dark)
        composites.push({
            input: { create: { width: w, height: h, channels: 4, background: '#193d5a' } },
            top: 0, left: 0
        });

        // Overlays (Box + Faded Image)
        for (const ol of plan.overlays) {
            const box = Buffer.from(`<svg width="${ol.bounds.width}" height="${ol.bounds.height}"><rect x="0" y="0" width="${ol.bounds.width}" height="${ol.bounds.height}" fill="none" stroke="red" stroke-width="5"/></svg>`);
            composites.push({ input: box, top: ol.bounds.y, left: ol.bounds.x });

            const img = await sharp(ol.resolvedPath).resize(ol.bounds.width, ol.bounds.height).modulate({ brightness: 0.5 }).toBuffer();
            composites.push({ input: img, top: ol.bounds.y, left: ol.bounds.x });
        }

        // Subtitle Safe Area (if applicable)
        if (plan.subtitleArea) {
            const sa = plan.subtitleArea;
            const subBox = Buffer.from(`<svg width="${w}" height="${h}"><rect x="${sa.x}" y="${sa.y}" width="${sa.width}" height="${sa.height}" fill="rgba(0,255,0,0.3)" stroke="green" stroke-width="2"/></svg>`);
            composites.push({ input: subBox, top: 0, left: 0 });
        }

        await sharp({ create: { width: w, height: h, channels: 4, background: '#000000' } })
            .composite(composites)
            .png()
            .toFile(outputFile);
    }
}
