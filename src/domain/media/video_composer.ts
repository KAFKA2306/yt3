import path from "node:path";
import fs from "fs-extra";
import { getKafkaVisualSystem } from "../design/kafka_visual_system.js";
import type { RenderPlan } from "../types.js";
import { runFfmpeg } from "./ffmpeg.js";

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
	public config: VideoCompositionConfig;

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
			videoPlan,
		);
		const bgColor = getKafkaVisualSystem().colors.background;
		const codec = this.config.codec ?? "libx264";
		const inputs: string[] = [
			"-f",
			"lavfi",
			"-i",
			`color=c=${bgColor}:s=${width}x${height}:r=${this.config.fps}`,
			"-i",
			audioPath,
			...videoPlan.overlays.flatMap((overlay) => ["-i", overlay.resolvedPath]),
		];
		if (
			this.config.thumbnail_overlay?.enabled &&
			thumbnailPath &&
			fs.existsSync(thumbnailPath)
		) {
			inputs.push("-i", thumbnailPath);
		}

		console.log("Complex Filter:", filters.join(";"));

		await runFfmpeg([
			...inputs,
			"-y",
			"-filter_complex",
			filters.join(";"),
			"-map",
			"[outv]",
			"-map",
			"1:a",
			"-shortest",
			"-c:v",
			codec,
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			"-b:a",
			"192k",
			outputPath,
		]);
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
		videoPlan: RenderPlan,
	): string[] {
		const filters: string[] = [];
		// Convert base to rgba to ensure consistent blending with alpha overlays
		filters.push("[0:v]format=rgba,setsar=1[v_base]");
		let lastStream = "v_base";
		let inputIndex = 2; // 0: color, 1: audio, 2+: overlays

		// Apply Overlays
		for (let i = 0; i < videoPlan.overlays.length; i++) {
			const overlay = videoPlan.overlays[i];
			if (!overlay) continue;
			const overlayStream = `ovr_${i}`;
			const nextStream = `v_${i}`;

			const overlayWidth = Math.max(2, Math.round(overlay.bounds.width));
			const overlayHeight = Math.max(2, Math.round(overlay.bounds.height));
			const overlayX = Math.round(overlay.bounds.x);
			const overlayY = Math.round(overlay.bounds.y);
			filters.push(
				`[${inputIndex}:v]format=rgba,scale=${overlayWidth}:${overlayHeight}:flags=lanczos,setsar=1[${overlayStream}]`,
			);

			const enable = this.buildEnableExpression(overlay.config);
			const enableClause = enable ? `:enable='${enable}'` : "";
			filters.push(
				`[${lastStream}][${overlayStream}]overlay=${overlayX}:${overlayY}:format=auto${enableClause}[${nextStream}]`,
			);
			lastStream = nextStream;
			inputIndex++;
		}

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

		// Add subtle noise to prevent freeze detection from failing on still images
		filters.push(`[${lastStream}]noise=alls=5:allf=t[v_variance]`);
		lastStream = "v_variance";

		const fontsDir = this.config.subtitles?.font_path
			? path.dirname(path.resolve(this.config.subtitles.font_path))
			: "";

		// Subtitles MUST be the last filter in this chain for [outv] mapping
		filters.push(
			`[${lastStream}]subtitles=${subtitlePath}${fontsDir ? `:fontsdir='${fontsDir}'` : ""}[outv]`,
		);

		return filters;
	}

	private buildEnableExpression(config: {
		start_time?: number;
		end_time?: number;
	}): string | undefined {
		const { start_time: start, end_time: end } = config;
		if (start === undefined && end === undefined) return undefined;
		if (start !== undefined && end !== undefined)
			return `between(t,${start},${end})`;
		if (start !== undefined) return `gte(t,${start})`;
		return `lte(t,${end})`;
	}
}
