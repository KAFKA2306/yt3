import sharp from "sharp";
import { resolvePath } from "../../io/core.js";
import { IqaValidator } from "../../io/utils/iqa_validator.js";
import { getKafkaVisualSystem } from "../design/kafka_visual_system.js";
import type { AppConfig, RenderPlan } from "../types.js";

type Palette = AppConfig["steps"]["thumbnail"]["palettes"][number];

export class ThumbnailRenderer {
	private validator: IqaValidator;
	private design = getKafkaVisualSystem();
	constructor(private config: AppConfig) {
		this.validator = new IqaValidator(this.config);
	}

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
			const bgHex = this.design.colors.background;
			const textHex = this.design.colors.text_primary;
			const contrast = this.validator.calculateContrastRatio(textHex, bgHex);
			const contrastScore = Math.min(contrast / 21, 1.0);
			const bgRisk = this.validator.analyzeBackgroundRisk(bgHex);
			const riskScore =
				bgRisk === "low" ? 1.0 : bgRisk === "medium" ? 0.5 : 0.0;
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
		const canvas = this.design.canvas.thumbnail;
		const palettes = cfg.palettes;
		if (!palettes || palettes.length === 0) throw new Error("No palette");
		const palette = this.selectBestPalette(palettes);

		let layers: sharp.OverlayOptions[] = [];
		if (palette.background_image) {
			const bgPath = resolvePath(palette.background_image);
			layers.push({
				input: await sharp(bgPath)
					.resize(canvas.width, canvas.height)
					.toBuffer(),
				top: 0,
				left: 0,
			});
		} else {
			const backdrop = {
				create: {
					width: canvas.width,
					height: canvas.height,
					channels: 4 as const,
					background: this.design.colors.background,
				},
			};
			layers.push({ input: backdrop, top: 0, left: 0 });
		}

		for (const ol of plan.overlays) {
			const width = Math.max(1, Math.round(ol.bounds.width));
			const height = Math.max(1, Math.round(ol.bounds.height));
			const top = Math.round(ol.bounds.y);
			const left = Math.round(ol.bounds.x);

			layers = [
				...layers,
				{
					input: await sharp(ol.resolvedPath).resize(width, height).toBuffer(),
					top,
					left,
				},
			];
		}

		const rightSideOverlays = plan.overlays.filter(
			(o: { bounds: { x: number } }) => o.bounds.x > canvas.width / 2,
		);
		let textMaxX =
			(rightSideOverlays.length
				? Math.min(
						...rightSideOverlays.map(
							(o: { bounds: { x: number } }) => o.bounds.x,
						),
					)
				: canvas.width) - 20;
		textMaxX = Math.min(
			textMaxX,
			this.design.thumbnail.title_zone.x +
				this.design.thumbnail.title_zone.width,
		);

		layers = [
			...layers,
			{
				input: Buffer.from(this.createSvg(title, textMaxX)),
				top: 0,
				left: 0,
			},
		];

		await sharp({
			create: {
				width: canvas.width,
				height: canvas.height,
				channels: 4 as const,
				background: this.design.colors.background,
			},
		})
			.composite(layers)
			.png()
			.toFile(output);
	}

	private createSvg(title: string, maxX: number): string {
		const titleZone = this.design.thumbnail.title_zone;
		const maxLines = titleZone.max_lines;
		const lineBudget = title.replace(/\n/g, "").length;
		let maxChars = Math.max(
			1,
			titleZone.max_chars_per_line,
			Math.ceil(lineBudget / maxLines),
		);
		let lines = this.wrapTitleLines(title, maxChars);
		while (lines.length > maxLines && maxChars < lineBudget) {
			maxChars += 1;
			lines = this.wrapTitleLines(title, maxChars);
		}

		const fz = titleZone.font_size;
		const fontName = `${this.design.typography.display}, "${this.design.typography.japanese}", sans-serif`;
		const lh = titleZone.line_height;
		const padding = titleZone.x;

		const startY =
			(this.design.canvas.thumbnail.height - lines.length * lh) / 2 + lh / 2;

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
		<svg width="${this.design.canvas.thumbnail.width}" height="${this.design.canvas.thumbnail.height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <clipPath id="s">
					<rect x="${titleZone.x}" y="${titleZone.y}" width="${maxX - titleZone.x}" height="${titleZone.height}"/>
                </clipPath>
            </defs>
            <style>
				text { font-family: '${fontName}', sans-serif; font-size: ${fz}px; font-weight: ${titleZone.font_weight}; text-anchor: start; dominant-baseline: middle; letter-spacing: 0px; text-rendering: geometricPrecision; }
				.outline { fill: none; stroke: ${titleZone.outer_stroke}; stroke-width: ${titleZone.outer_stroke_width}px; stroke-linejoin: round; }
				.fill { fill: ${titleZone.fill}; stroke: ${titleZone.inner_stroke}; stroke-width: ${titleZone.inner_stroke_width}px; paint-order: stroke fill; stroke-linejoin: round; }
            </style>
				<g clip-path="url(#s)">${txt}</g>
        </svg>`;
	}

	private wrapTitleLines(title: string, maxChars: number): string[] {
		const originalLines = title.split("\n").filter((l) => l.trim());
		const lines: string[] = [];
		for (const line of originalLines) {
			if (line.length <= maxChars) {
				lines.push(line);
				continue;
			}

			// Try to split by common Japanese/English punctuation first, then by length
			const parts = line.split(/(?<=[、。，．,.\s])/);
			let current = "";
			for (const part of parts) {
				if ((current + part).length <= maxChars) {
					current += part;
				} else {
					if (current) lines.push(current);
					current = part;
					// If a single part is still > maxChars characters, split it forcefully
					while (current.length > maxChars) {
						lines.push(current.slice(0, maxChars));
						current = current.slice(maxChars);
					}
				}
			}
			if (current) lines.push(current);
		}
		return lines;
	}
}
