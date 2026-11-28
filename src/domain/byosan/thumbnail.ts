import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import sharp from "sharp";

export type ThumbnailConfig = {
	imagegen: { size: string; prompt: string };
	jpeg_quality: number;
	jpeg_chroma_subsampling: "4:2:0" | "4:4:4";
};

export function buildByosanThumbnailPrompt(
	template: string,
	topic: string,
): string {
	if (!template.includes("{topic}")) {
		throw new Error("BYOSAN_THUMBNAIL_PROMPT_MISSING_TOPIC");
	}
	return template.replaceAll("{topic}", topic);
}

export function generateThumbnailArt(
	config: ThumbnailConfig,
	topic: string,
	refs: string[],
	outPath: string,
): void {
	const result = spawnSync(
		"codex-imagegen",
		[
			buildByosanThumbnailPrompt(config.imagegen.prompt, topic),
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

async function writeThumbnailRenditions(input: {
	full: Buffer;
	fullPath: string;
	pngPath: string;
	jpgPath: string;
	thumbnailWidth: number;
	thumbnailHeight: number;
	pngCompression: number;
	config: ThumbnailConfig;
}): Promise<void> {
	await fs.writeFile(input.fullPath, input.full);
	const resized = sharp(input.full).resize(
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

export async function buildByosanThumbnailFiles(input: {
	topic: string;
	artPath: string;
	refs: string[];
	fullPath: string;
	pngPath: string;
	jpgPath: string;
	width: number;
	height: number;
	thumbnailWidth: number;
	thumbnailHeight: number;
	pngCompression: number;
	config: ThumbnailConfig;
}): Promise<void> {
	if (!(await fs.pathExists(input.artPath))) {
		await fs.ensureDir(path.dirname(input.artPath));
		generateThumbnailArt(input.config, input.topic, input.refs, input.artPath);
	}
	const full = await sharp(await fs.readFile(input.artPath))
		.resize(input.width, input.height, { fit: "cover", position: "centre" })
		.png()
		.toBuffer();
	await writeThumbnailRenditions({ ...input, full });
}
