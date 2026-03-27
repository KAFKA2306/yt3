import path from "node:path";
import os from "node:os";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs-extra";
import type { RenderPlan } from "../layout_engine.js";

export interface VideoCompositionConfig {
	resolution: string;
	fps: number;
	codec?: string;
	background_color?: string;
	intro_seconds?: number;
	subtitles?: {
		font_path?: string;
	};
	thumbnail_overlay?: {
		enabled: boolean;
	};
}

export class VideoComposer {
	private config: VideoCompositionConfig;

	constructor(config: VideoCompositionConfig) {
		this.config = config;
	}

	async compose(
		audioPath: string,
		thumbnailPath: string,
		subtitlePath: string,
		outputPath: string,
		videoPlan: RenderPlan,
	): Promise<void> {
		const [width, height] = this.parseResolution();
		const filters = this.buildFilterChain(
			width,
			height,
			thumbnailPath,
			subtitlePath,
		);

		return new Promise((resolve, reject) => {
			const bgColor = this.config.background_color ?? "#000000";
			const cmd = ffmpeg()
				.input(`color=c=${bgColor}:s=${width}x${height}:r=${this.config.fps}`)
				.inputFormat("lavfi")
				.input(audioPath);

			let inputIndex = 2;
			for (const overlay of videoPlan.overlays) {
				cmd.input(overlay.resolvedPath);
				inputIndex++;
			}

			if (
				this.config.thumbnail_overlay?.enabled &&
				thumbnailPath &&
				fs.existsSync(thumbnailPath)
			) {
				cmd.input(thumbnailPath);
			}

			cmd.complexFilter(filters)
				.outputOptions([
					"-map",
					"[outv]",
					"-map",
					"1:a",
					"-shortest",
					"-c:v",
					this.config.codec,
					"-pix_fmt",
					"yuv420p",
				])
				.save(outputPath)
				.on("end", () => resolve())
				.on("error", reject);
		});
	}

	private parseResolution(): [string, string] {
		const parts = this.config.resolution.split("x");
		const width = parts[0] || "1920";
		const height = parts[1] || "1080";
		return [width, height];
	}

	private buildFilterChain(
		width: string,
		height: string,
		thumbnailPath: string,
		subtitlePath: string,
	): string[] {
		const filters: string[] = [];
		let lastStream = "0:v";
		let inputIndex = 2;

		// Process all overlays (from RenderPlan)
		// Note: This is a placeholder - actual overlays would come from RenderPlan
		// which would be passed explicitly in production code

		// Apply thumbnail overlay if enabled
		if (
			this.config.thumbnail_overlay?.enabled &&
			thumbnailPath &&
			fs.existsSync(thumbnailPath)
		) {
			const thumbInputIndex = inputIndex;
			filters.push(
				`[${thumbInputIndex}:v]scale=${width}:${height}[thumb]`,
				`[${lastStream}][thumb]overlay=0:0:enable='lte(t,${this.config.intro_seconds})'[v_thumb]`,
			);
			lastStream = "v_thumb";
		}

		// Apply subtitles
		const fontsDir = this.config.subtitles?.font_path
			? path.dirname(path.resolve(this.config.subtitles.font_path))
			: "";
		filters.push(
			`[${lastStream}]subtitles=${subtitlePath}${fontsDir ? `:fontsdir=${fontsDir}` : ""}[outv]`,
		);

		return filters;
	}
}
