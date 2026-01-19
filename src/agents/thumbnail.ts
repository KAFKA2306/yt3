
import path from "path";
import fs from "fs-extra";
import sharp from "sharp";
import { AssetStore } from "../asset.js";
import { loadConfig } from "../config.js";
import { Script } from "../models.js";

interface Palette {
    background_color: string;
    title_color: string;
    outline_inner_color: string;
    outline_inner_width: number;
    outline_outer_color: string;
    outline_outer_width: number;
    subtitle_color?: string;
}

export class ThumbnailAgent {
    store: AssetStore;
    config: any;

    constructor(store: AssetStore) {
        this.store = store;
        this.config = loadConfig().steps.thumbnail;
    }

    async run(script: Script): Promise<string> {
        this.store.logInput("thumbnail", script);

        const palette: Palette = this.config.palettes[Math.floor(Math.random() * this.config.palettes.length)];
        const width = this.config.width;
        const height = this.config.height;

        const canvas = sharp({
            create: {
                width: width,
                height: height,
                channels: 4,
                background: palette.background_color
            }
        });

        const title = script.title || "最新ニュース";
        const subtitle = script.description || "";

        const svg = this.createSvg(title, subtitle, palette);
        const composition: any[] = [{ input: Buffer.from(svg), top: 0, left: 0 }];

        const enabled = this.config.overlays.filter((ov: any) => ov.enabled);
        await Promise.all(enabled.map(async (ov: any) => {
            const h = ov.height || Math.floor(height * (ov.height_ratio || 0.85));
            const ovImg = await sharp(ov.image_path).resize({ height: h }).toBuffer();
            const meta = await sharp(ovImg).metadata();
            const iw = meta.width || 0;
            const ih = meta.height || 0;

            const anchors: Record<string, any> = {
                "bottom_right": { top: height - ih - (ov.offset?.bottom || 0), left: width - iw - (ov.offset?.right || 0) },
                "bottom_left": { top: height - ih - (ov.offset?.bottom || 0), left: (ov.offset?.left || 0) },
                "top_right": { top: (ov.offset?.top || 0), left: width - iw - (ov.offset?.right || 0) },
                "top_left": { top: (ov.offset?.top || 0), left: (ov.offset?.left || 0) },
                "center": { top: Math.floor((height - ih) / 2), left: Math.floor((width - iw) / 2) }
            };

            composition.push({ input: ovImg, ...anchors[ov.anchor] });
        }));

        const outPath = path.join(this.store.runDir, "thumbnail.png");
        await canvas.composite(composition).png().toFile(outPath);
        this.store.logOutput("thumbnail", { path: outPath });
        return outPath;
    }

    createSvg(title: string, subtitle: string, palette: Palette): string {
        const width = this.config.width;
        const height = this.config.height;
        const padding = this.config.padding;
        const guardBand = this.config.right_guard_band_px || 0;

        const titleSize = this.config.title_font_size;
        const subSize = this.config.subtitle_font_size;
        const fontPath = path.resolve(this.config.font_path);

        const titleLines = this.wrapText(title, this.config.max_chars_per_line, this.config.max_lines);
        const innerStroke = palette.outline_inner_width;
        const outerStroke = palette.outline_outer_width + innerStroke;

        const showSub = this.config.show_subtitle && subtitle;
        const totalTextHeight = (titleLines.length * titleSize * 1.0) + (showSub ? subSize * 1.5 : 0);
        const startY = (height - totalTextHeight) / 2 + titleSize * 0.8;

        const titleSpans = titleLines.map((line, i) =>
            `<tspan x="${padding}" dy="${i === 0 ? 0 : titleSize * 1.0}">${line}</tspan>`
        ).join("");

        let subtitleSection = "";
        if (showSub) {
            const subY = startY + (titleLines.length * titleSize * 1.0) + (subSize * 0.2);
            subtitleSection = `
                <text x="${padding}" y="${subY}" class="text-base sub-fill">${subtitle.slice(0, 40)}</text>
            `;
        }

        return `
            <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                <style>
                    @font-face {
                        font-family: 'Zen Maru Gothic';
                        src: url('file://${fontPath}');
                    }
                    .text-base {
                        font-family: 'Zen Maru Gothic', sans-serif;
                        font-weight: bold;
                        paint-order: stroke fill;
                    }
                    .title-base {
                        font-size: ${titleSize}px;
                    }
                    .outer {
                        stroke: ${palette.outline_outer_color};
                        stroke-width: ${outerStroke}px;
                    }
                    .inner {
                        stroke: ${palette.outline_inner_color};
                        stroke-width: ${innerStroke}px;
                    }
                    .fill {
                        fill: ${palette.title_color};
                    }
                    .sub-fill {
                        font-size: ${subSize}px;
                        fill: ${palette.subtitle_color || palette.title_color};
                    }
                </style>
                <text x="${padding}" y="${startY}" class="text-base title-base outer">${titleSpans}</text>
                <text x="${padding}" y="${startY}" class="text-base title-base inner">${titleSpans}</text>
                <text x="${padding}" y="${startY}" class="text-base title-base fill">${titleSpans}</text>
                ${subtitleSection}
            </svg>
        `;
    }

    wrapText(text: string, maxChars: number, maxLines: number): string[] {
        // Support explicit line breaks
        if (text.includes("\n")) {
            return text.split("\n").slice(0, maxLines);
        }

        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += maxChars) {
            chunks.push(text.slice(i, i + maxChars));
        }
        return chunks.slice(0, maxLines);
    }
}

function languages_fallback_check() { return 100; } // dummy
