import path from "node:path";
import fs from "fs-extra";
import sharp from "sharp";
import {
	type KafkaVisualSystem,
	getKafkaVisualSystem,
} from "../domain/design/kafka_visual_system.js";

const root = process.cwd();
const outputDir = path.join(root, "artifacts/design-system/v1");

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function label(text: string, x: number, y: number, size = 20): string {
	return `<text x="${x}" y="${y}" fill="#FFFDF8" font-family="Noto Sans JP, sans-serif" font-size="${size}">${escapeXml(text)}</text>`;
}

function rect(
	box: { x: number; y: number; width: number; height: number },
	color: string,
	opacity = 1,
	dash = "",
): string {
	return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="none" stroke="${color}" stroke-width="2" stroke-opacity="${opacity}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
}

function surfaceSvg(
	design: KafkaVisualSystem,
	kind: "landscape" | "shorts" | "thumbnail",
): string {
	const canvas = design.canvas[kind];
	const colors = design.colors;
	const isLandscape = kind === "landscape";
	const title =
		kind === "landscape"
			? "LANDSCAPE 1920×1080"
			: kind === "shorts"
				? "SHORTS 1080×1920"
				: "THUMBNAIL 1280×720";
	type Box = { x: number; y: number; width: number; height: number };
	const boxes: Array<[string, Box]> = isLandscape
		? [
				[
					"safe area",
					{
						x: design.landscape.safe_area.left,
						y: design.landscape.safe_area.top,
						width:
							canvas.width -
							design.landscape.safe_area.left -
							design.landscape.safe_area.right,
						height:
							canvas.height -
							design.landscape.safe_area.top -
							design.landscape.safe_area.bottom,
					},
				],
				["caption band", design.landscape.caption_band],
				[
					"headline",
					{
						x: design.landscape.headline.x,
						y:
							design.landscape.headline.baseline_y -
							design.landscape.headline.default_line_height,
						width: design.landscape.headline.max_width,
						height: design.landscape.headline.default_line_height * 2,
					},
				],
				["data/chart", design.landscape.data_region],
				["character", design.landscape.character_region],
				[
					"source",
					{
						x: design.landscape.source.x,
						y: design.landscape.source.baseline_y - 24,
						width: design.landscape.source.max_width,
						height: 32,
					},
				],
				["outer frame", design.landscape.outer_frame],
			]
		: kind === "shorts"
			? [
					[
						"safe area",
						{
							x: design.shorts.safe_area.left,
							y: design.shorts.safe_area.top,
							width:
								canvas.width -
								design.shorts.safe_area.left -
								design.shorts.safe_area.right,
							height:
								canvas.height -
								design.shorts.safe_area.top -
								design.shorts.safe_area.bottom,
						},
					],
					["main visual", design.shorts.main_visual_zone],
					["caption band", design.shorts.caption_band],
					["outer frame", design.shorts.outer_frame],
				]
			: [
					[
						"safe area",
						{
							x: design.thumbnail.safe_area.left,
							y: design.thumbnail.safe_area.top,
							width:
								canvas.width -
								design.thumbnail.safe_area.left -
								design.thumbnail.safe_area.right,
							height:
								canvas.height -
								design.thumbnail.safe_area.top -
								design.thumbnail.safe_area.bottom,
						},
					],
					["title", design.thumbnail.title_zone],
					["character", design.thumbnail.character_zone],
					["outer frame", design.thumbnail.outer_frame],
				];
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><rect width="100%" height="100%" fill="${colors.background}"/><rect x="0" y="0" width="${canvas.width}" height="${canvas.height}" fill="${colors.background_alt}" opacity="0.32"/>${label(title, 24, 40, 24)}${boxes.map(([name, box], index) => `${rect(box as { x: number; y: number; width: number; height: number }, index === 0 ? colors.accent_primary : index % 2 ? colors.warning : colors.accent_secondary, index === 0 ? 0.85 : 0.7, index === 0 ? "10 8" : "")}${label(`${name} ${box.x},${box.y} ${box.width}×${box.height}`, box.x + 8, box.y + 24, Math.max(14, Math.round(canvas.width / 90)))}`).join("")}</svg>`;
}

function componentSheetSvg(design: KafkaVisualSystem): string {
	const c = design.colors;
	const t = design.templates;
	const items = Object.entries(t).slice(0, 8);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="${c.background}"/>${label("COMPONENT SHEET / v1", 48, 56, 32)}${items
		.map(([name, box], index) => {
			const x = 48 + (index % 2) * 760;
			const y = 96 + Math.floor(index / 2) * 190;
			return `<rect x="${x}" y="${y}" width="704" height="144" rx="${design.radius.card}" fill="${c.surface}" stroke="${c.accent_primary}" stroke-opacity="0.5"/>${label(name, x + 24, y + 38, 24)}${label(JSON.stringify(box), x + 24, y + 80, 16)}`;
		})
		.join("")}</svg>`;
}

function colorSheetSvg(design: KafkaVisualSystem): string {
	const entries = Object.entries(design.colors);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="${design.colors.background}"/>${label("COLOR SHEET / v1", 40, 48, 30)}${entries
		.map(([name, color], index) => {
			const x = 40 + (index % 4) * 300;
			const y = 80 + Math.floor(index / 4) * 105;
			return `<rect x="${x}" y="${y}" width="260" height="72" rx="${design.radius.small}" fill="${color}"/><text x="${x + 12}" y="${y + 30}" fill="${color === design.colors.text_primary || color === design.colors.text_secondary || color === design.colors.human_cream ? design.colors.text_dark : design.colors.text_primary}" font-family="Noto Sans JP, sans-serif" font-size="18">${escapeXml(name)}</text><text x="${x + 12}" y="${y + 56}" fill="${color === design.colors.text_primary || color === design.colors.text_secondary || color === design.colors.human_cream ? design.colors.text_dark : design.colors.text_primary}" font-family="monospace" font-size="16">${color}</text>`;
		})
		.join("")}</svg>`;
}

function documentation(design: KafkaVisualSystem): string {
	const L = design.landscape;
	const S = design.shorts;
	const T = design.thumbnail;
	return `<!-- GENERATED FROM config/design/kafka_visual_system_v1.json. Do not edit numeric values here. -->
# Kafka Visual Design System v1

唯一の正本は [kafka_visual_system_v1.json](../../config/design/kafka_visual_system_v1.json) です。renderer はこの JSON を read-only で参照します。

## Canvas

| Surface | Width | Height | FPS |
| --- | ---: | ---: | ---: |
| Landscape | ${design.canvas.landscape.width} | ${design.canvas.landscape.height} | ${design.canvas.landscape.fps} |
| Shorts | ${design.canvas.shorts.width} | ${design.canvas.shorts.height} | ${design.canvas.shorts.fps} |
| Thumbnail | ${design.canvas.thumbnail.width} | ${design.canvas.thumbnail.height} | — |

## Landscape geometry

| Region | x | y | width | height |
| --- | ---: | ---: | ---: | ---: |
| Outer frame | ${L.outer_frame.x} | ${L.outer_frame.y} | ${L.outer_frame.width} | ${L.outer_frame.height} |
| Caption band | ${L.caption_band.x} | ${L.caption_band.y} | ${L.caption_band.width} | ${L.caption_band.height} |
| Data region | ${L.data_region.x} | ${L.data_region.y} | ${L.data_region.width} | ${L.data_region.height} |
| Character region | ${L.character_region.x} | ${L.character_region.y} | ${L.character_region.width} | ${L.character_region.height} |
| Source baseline | ${L.source.x} | ${L.source.baseline_y} | ${L.source.max_width} | — |

## Thumbnail and Shorts geometry

| Surface | Region | x | y | width | height |
| --- | --- | ---: | ---: | ---: | ---: |
| Thumbnail | Title | ${T.title_zone.x} | ${T.title_zone.y} | ${T.title_zone.width} | ${T.title_zone.height} |
| Thumbnail | Character | ${T.character_zone.x} | ${T.character_zone.y} | ${T.character_zone.width} | ${T.character_zone.height} |
| Shorts | Main visual | ${S.main_visual_zone.x} | ${S.main_visual_zone.y} | ${S.main_visual_zone.width} | ${S.main_visual_zone.height} |
| Shorts | Caption band | ${S.caption_band.x} | ${S.caption_band.y} | ${S.caption_band.width} | ${S.caption_band.height} |

## Motion

\`${JSON.stringify(design.motion)}\`
`;
}

async function writePng(name: string, svg: string): Promise<void> {
	await sharp(Buffer.from(svg)).png().toFile(path.join(outputDir, name));
}

const design = getKafkaVisualSystem();
await fs.ensureDir(outputDir);
await writePng("landscape-wireframe.png", surfaceSvg(design, "landscape"));
await writePng("shorts-wireframe.png", surfaceSvg(design, "shorts"));
await writePng("thumbnail-wireframe.png", surfaceSvg(design, "thumbnail"));
await writePng("component-sheet.png", componentSheetSvg(design));
await writePng("color-sheet.png", colorSheetSvg(design));
await fs.writeFile(
	path.join(root, "docs/standard/kafka-visual-design-system-v1.md"),
	documentation(design),
);
console.log(`[design-preview] wrote 5 artifacts to ${outputDir}`);
