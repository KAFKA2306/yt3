import sharp from "sharp";
import type { AppConfig } from "./config_types.js";
import type { RenderPlan } from "./layout_engine.js";
import { IqaValidator } from "./utils/iqa_validator.js";

type Palette = AppConfig["steps"]["thumbnail"]["palettes"][number];

export class ThumbnailRenderer {
  private validator: IqaValidator;

  constructor(private config: AppConfig) {
    this.validator = new IqaValidator();
  }

  /**
   * 最良パレットを選択する。
   * 暗い背景ほどモバイルエッジ強度が高く MOBILE_EDGE_WEAK を避けられるため、
   * 輝度ベースのスコアリングで選択する。
   */
  selectBestPalette(palettes: Palette[]): Palette {
    if (!palettes || palettes.length === 0) {
      throw new Error("No palettes configured");
    }
    const first = palettes[0];
    if (!first) throw new Error("No palettes configured");
    if (palettes.length === 1) return first;

    interface ScoredPalette {
      palette: Palette;
      score: number;
    }
    const scored: ScoredPalette[] = palettes.map((p) => {
      const bgHex = p.background_color || "#000000";
      const textHex = p.title_color || "#FFFFFF";

      // コントラスト比 (0–21)
      const contrast = this.validator.calculateContrastRatio(textHex, bgHex);
      const contrastScore = Math.min(contrast / 21, 1.0);

      // 背景リスク: low=1.0, medium=0.5, high=0.0
      const bgRisk = this.validator.analyzeBackgroundRisk(bgHex);
      const riskScore = bgRisk === "low" ? 1.0 : bgRisk === "medium" ? 0.5 : 0.0;

      const score = contrastScore * 0.6 + riskScore * 0.4;
      return { palette: p, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) throw new Error("No best palette found");
    return best.palette;
  }

  async render(plan: RenderPlan, title: string, output: string): Promise<void> {
    const cfg = this.config.steps.thumbnail;
    const palettes = cfg.palettes;

    if (!palettes || palettes.length === 0) throw new Error("No palette");

    const palette = this.selectBestPalette(palettes);

    const backdrop = {
      create: {
        width: cfg.width,
        height: cfg.height,
        channels: 4 as const,
        background: palette.background_color,
      },
    };
    const layers: sharp.OverlayOptions[] = [{ input: backdrop, top: 0, left: 0 }];

    for (const ol of plan.overlays) {
      layers.push({
        input: await sharp(ol.resolvedPath).resize(ol.bounds.width, ol.bounds.height).toBuffer(),
        top: ol.bounds.y,
        left: ol.bounds.x,
      });
    }

    const rightSideOverlays = plan.overlays.filter((o) => o.bounds.x > cfg.width / 2);
    const textMaxX =
      (rightSideOverlays.length
        ? Math.min(...rightSideOverlays.map((o) => o.bounds.x))
        : cfg.width) - 20;
    layers.push({
      input: Buffer.from(this.createSvg(title, textMaxX, cfg, palette)),
      top: 0,
      left: 0,
    });

    await sharp({
      create: { width: cfg.width, height: cfg.height, channels: 4 as const, background: "#000" },
    })
      .composite(layers)
      .png()
      .toFile(output);
  }

  private createSvg(
    title: string,
    maxX: number,
    cfg: AppConfig["steps"]["thumbnail"],
    pal: Palette,
  ): string {
    const lines = title.split("\n").filter((l) => l.trim());
    const g = this.config.global_style;
    const tokens = this.config.design_tokens;

    const fz = cfg.title_font_size || g.thumbnail.title_size;
    const fontName = `${tokens?.font_display || "Geist"}, "IBM Plex Sans JP", sans-serif`;
    const lh = fz * 1.1;
    const padding = cfg.padding || 80;

    const startY = (cfg.height - lines.length * lh) / 2 + lh / 2;

    const txt = lines
      .map((l, i) => {
        const y = startY + i * lh;
        const escaped = l
          .toUpperCase()
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        return `<text x="${padding}" y="${y}" class="outline">${escaped}</text>
                    <text x="${padding}" y="${y}" class="fill">${escaped}</text>`;
      })
      .join("");

    return `
        <svg width="${cfg.width}" height="${cfg.height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <clipPath id="s">
                    <rect x="0" y="0" width="${maxX}" height="${cfg.height}"/>
                </clipPath>
            </defs>
            <style>
                text { font-family: '${fontName}', sans-serif; font-size: ${fz}px; font-weight: 900; text-anchor: start; dominant-baseline: middle; letter-spacing: 2px; text-rendering: geometricPrecision; } 
                .outline { fill: none; stroke: ${pal.outline_outer_color || "#000000"}; stroke-width: ${(pal.outline_outer_width || 20) * 2}px; stroke-linejoin: round; } 
                .fill { fill: ${pal.title_color || "#FFFFFF"}; stroke: ${pal.outline_inner_color || "#FFFFFF"}; stroke-width: ${pal.outline_inner_width || 10}px; paint-order: stroke fill; stroke-linejoin: round; }
            </style>
            <g clip-path="url(#s)">${txt}</g>
        </svg>`;
  }
}
