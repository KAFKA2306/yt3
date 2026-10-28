import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import sharp from "sharp";
import { displayUnits, xml } from "./display_text.js";

export type ThumbnailConfig = {
	imagegen: { size: string; prompt: string };
	text: {
		x: number;
		y: number;
		width: number;
		height: number;
		max_font_ratio: number;
		line_height: number;
		max_lines: number;
		fill: string;
		stroke: string;
		stroke_ratio: number;
		break_penalty: number;
	};
	brand: { x: number; y: number; font_ratio: number };
	scrim: { width: number; opacity: number; color: string };
};

export function generateThumbnailArt(
	config: ThumbnailConfig,
	topic: string,
	refs: string[],
	outPath: string,
): void {
	const result = spawnSync(
		"codex-imagegen",
		[
			config.imagegen.prompt.replaceAll("{topic}", topic),
			outPath,
			"--size",
			config.imagegen.size,
			...refs.flatMap((ref) => ["--ref", ref]),
		],
		{ stdio: ["ignore", "inherit", "inherit"] },
	);
	if (result.status !== 0) {
		throw new Error(
			`BYOSAN_THUMBNAIL_IMAGEGEN_FAILED: status=${result.status}`,
		);
	}
}

const BREAK_AFTER = new Set(Array.from("、？はがをにでとのも"));

function splitLines(
	text: string,
	count: number,
	halfWidthUnits: number,
	penalty: number,
): string[] {
	const chars = Array.from(text);
	const cuts = (n: number, from: number): number[][] =>
		n === 0
			? [[]]
			: Array.from(
					{ length: chars.length - from - n + 1 },
					(_, i) => from + 1 + i,
				).flatMap((cut) => cuts(n - 1, cut).map((rest) => [cut, ...rest]));
	const cost = (positions: number[]): number => {
		const edges = [0, ...positions, chars.length];
		const lines = edges
			.slice(0, -1)
			.map((start, i) => chars.slice(start, edges[i + 1]).join(""));
		const widest = Math.max(
			...lines.map((line) => displayUnits(line, halfWidthUnits)),
		);
		const bad = positions.filter(
			(position) => !BREAK_AFTER.has(chars[position - 1] ?? ""),
		).length;
		return widest + bad * penalty;
	};
	const best = cuts(count - 1, 0).reduce((winner, candidate) =>
		cost(candidate) < cost(winner) ? candidate : winner,
	);
	const edges = [0, ...best, chars.length];
	return edges
		.slice(0, -1)
		.map((start, i) => chars.slice(start, edges[i + 1]).join(""))
		.filter(Boolean);
}

export function layoutThumbnailText(
	text: string,
	box: { width: number; height: number },
	config: ThumbnailConfig["text"],
	halfWidthUnits: number,
	canvasHeight: number,
): { lines: string[]; fontSize: number } {
	const candidates = Array.from({ length: config.max_lines }, (_, index) => {
		const lines = splitLines(
			text,
			index + 1,
			halfWidthUnits,
			config.break_penalty,
		);
		const widest = Math.max(
			...lines.map((line) => displayUnits(line, halfWidthUnits)),
		);
		const fontSize = Math.floor(
			Math.min(
				config.max_font_ratio * canvasHeight,
				box.width / widest,
				box.height / (lines.length * config.line_height),
			),
		);
		return { lines, fontSize };
	});
	return candidates.reduce((best, candidate) =>
		candidate.fontSize > best.fontSize ? candidate : best,
	);
}

export async function composeThumbnail(input: {
	artPath: string;
	text: string;
	brand: string;
	width: number;
	height: number;
	font: string;
	fontWeight: number | string;
	halfWidthUnits: number;
	config: ThumbnailConfig;
}): Promise<Buffer> {
	const { config, width, height } = input;
	const box = {
		x: Math.round(config.text.x * width),
		y: Math.round(config.text.y * height),
		width: Math.round(config.text.width * width),
		height: Math.round(config.text.height * height),
	};
	const { lines, fontSize } = layoutThumbnailText(
		input.text,
		box,
		config.text,
		input.halfWidthUnits,
		height,
	);
	const lineHeight = fontSize * config.text.line_height;
	const top = box.y + (box.height - lineHeight * lines.length) / 2;
	const brandSize = Math.round(config.brand.font_ratio * height);
	const tspans = lines
		.map(
			(line, index) =>
				`<tspan x="${box.x}" y="${Math.round(top + fontSize + index * lineHeight)}">${xml(line)}</tspan>`,
		)
		.join("");
	const overlay = Buffer.from(`
	<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
		<defs>
			<linearGradient id="scrim" x1="0" x2="1" y1="0" y2="0">
				<stop offset="0" stop-color="${config.scrim.color}" stop-opacity="${config.scrim.opacity}"/>
				<stop offset="1" stop-color="${config.scrim.color}" stop-opacity="0"/>
			</linearGradient>
		</defs>
		<rect width="${Math.round(config.scrim.width * width)}" height="${height}" fill="url(#scrim)"/>
		<text font-family="${input.font}, sans-serif" font-weight="${input.fontWeight}" font-size="${fontSize}" fill="${config.text.fill}" stroke="${config.text.stroke}" stroke-width="${Math.round(fontSize * config.text.stroke_ratio)}" stroke-linejoin="round" paint-order="stroke">${tspans}</text>
		<text x="${Math.round(config.brand.x * width)}" y="${Math.round(config.brand.y * height)}" font-family="${input.font}, sans-serif" font-weight="${input.fontWeight}" font-size="${brandSize}" fill="${config.text.fill}" stroke="${config.text.stroke}" stroke-width="${Math.round(brandSize * config.text.stroke_ratio)}" stroke-linejoin="round" paint-order="stroke">${xml(input.brand)}</text>
	</svg>`);
	return sharp(await fs.readFile(input.artPath))
		.resize(width, height, { fit: "cover", position: "centre" })
		.composite([{ input: overlay, left: 0, top: 0 }])
		.png()
		.toBuffer();
}

export async function buildThumbnailFiles(input: {
	text: string;
	artPath: string;
	refs: string[];
	fullPath: string;
	pngPath: string;
	jpgPath: string;
	brand: string;
	width: number;
	height: number;
	thumbnailWidth: number;
	thumbnailHeight: number;
	font: string;
	fontWeight: number | string;
	halfWidthUnits: number;
	pngCompression: number;
	config: ThumbnailConfig & {
		jpeg_quality: number;
		jpeg_chroma_subsampling: "4:2:0" | "4:4:4";
	};
}): Promise<void> {
	if (!(await fs.pathExists(input.artPath))) {
		await fs.ensureDir(path.dirname(input.artPath));
		generateThumbnailArt(input.config, input.text, input.refs, input.artPath);
	}
	const full = await composeThumbnail({
		artPath: input.artPath,
		text: input.text,
		brand: input.brand,
		width: input.width,
		height: input.height,
		font: input.font,
		fontWeight: input.fontWeight,
		halfWidthUnits: input.halfWidthUnits,
		config: input.config,
	});
	await fs.writeFile(input.fullPath, full);
	const resized = sharp(full).resize(
		input.thumbnailWidth,
		input.thumbnailHeight,
	);
	await resized
		.clone()
		.png({ compressionLevel: input.pngCompression })
		.toFile(input.pngPath);
	await resized
		.clone()
		.jpeg({
			quality: input.config.jpeg_quality,
			chromaSubsampling: input.config.jpeg_chroma_subsampling,
		})
		.toFile(input.jpgPath);
}
