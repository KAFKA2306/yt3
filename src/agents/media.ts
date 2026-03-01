import os from "node:os";
import path from "node:path";
import axios from "axios";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs-extra";

import {
	AgentLogger,
	type AssetStore,
	BaseAgent,
	RunStage,
	loadConfig,
	runMcpTool,
} from "../core.js";
import { LayoutEngine, type RenderPlan } from "../layout_engine.js";
import type { AppConfig, Script } from "../types.js";
import { IqaValidator } from "../utils/iqa_validator.js";
export interface MediaResult {
	audio_paths: string[];
	thumbnail_path: string;
	video_path: string;
	subtitle_path: string;
}
interface TrendInfo {
	data?: {
		recommended_palette?: {
			background_color: string;
			title_color: string;
		};
	};
}
export class VisualDirector extends BaseAgent {
	ttsUrl: string;
	speakers: Record<string, number>;
	videoConfig: AppConfig["steps"]["video"];
	thumbConfig: AppConfig["steps"]["thumbnail"];
	layout: LayoutEngine;
	validator: IqaValidator;
	constructor(store: AssetStore) {
		const cfg = loadConfig();
		super(store, RunStage.MEDIA, {
			temperature: cfg.providers.llm.media?.temperature || 0.1,
		});
		this.ttsUrl = cfg.providers.tts.voicevox.url;
		this.speakers = cfg.providers.tts.voicevox.speakers;
		this.videoConfig = cfg.steps.video;
		this.thumbConfig = cfg.steps.thumbnail;
		this.layout = new LayoutEngine();
		this.validator = new IqaValidator(cfg);
	}
	async run(script: Script, title: string): Promise<MediaResult> {
		this.logInput({ lines: script.lines.length });
		const audioDir = this.store.audioDir();
		const audio_paths: string[] = [];

		for (let i = 0; i < script.lines.length; i++) {
			const l = script.lines[i];
			if (!l) continue;
			const p = path.join(audioDir, `${String(i).padStart(3, "0")}.wav`);

			if (fs.existsSync(p)) {
				audio_paths.push(p);
				continue;
			}

			let speakerId = this.speakers[l.speaker];
			if (speakerId === undefined) {
				AgentLogger.warn(
					this.name,
					"RUN",
					"UNKNOWN_SPEAKER",
					`Fallback to narrator for unknown speaker: ${l.speaker}`,
				);
				speakerId = 11;
			}

			const cleanText = this.cleanScriptText(l.text);
			AgentLogger.info(
				this.name,
				"TTS",
				"GENERATE",
				`[${i + 1}/${script.lines.length}] ${l.speaker}: ${cleanText.slice(0, 30)}...`,
			);

			const q = await axios.post(`${this.ttsUrl}/audio_query`, null, {
				params: { text: cleanText, speaker: speakerId },
			});
			const s = await axios.post(`${this.ttsUrl}/synthesis`, q.data, {
				params: { speaker: speakerId },
				responseType: "arraybuffer",
			});

			fs.writeFileSync(p, Buffer.from(s.data));
			audio_paths.push(p);
		}
		const fullAudio = path.join(
			audioDir,
			this.store.cfg.workflow.filenames.audio_full,
		);
		const videoPlan = await this.layout.createVideoRenderPlan();
		const durations: number[] = [];
		const audioCmd = ffmpeg();
		for (const p of audio_paths) {
			audioCmd.input(p);
			durations.push(await this.getAudioDuration(p));
		}
		const assContent = this.layout.generateASS(script, durations, videoPlan);
		const subtitlePath = path.join(
			this.store.runDir,
			this.store.cfg.workflow.filenames.subtitles,
		);
		fs.writeFileSync(subtitlePath, assContent);
		await new Promise<void>((res, rej) =>
			audioCmd
				.on("error", rej)
				.on("end", () => res())
				.mergeToFile(fullAudio, os.tmpdir()),
		);
		let thumbnail_path = "";
		if (this.thumbConfig.enabled) {
			thumbnail_path = path.join(
				this.store.runDir,
				this.store.cfg.workflow.filenames.thumbnail,
			);
			let palette = this.thumbConfig.palettes?.[0] || {
				background_color: "#000000",
				title_color: "#FFFFFF",
			};
			const mcp = this.config.mcp;
			if (mcp?.servers.context7) {
				const result = (await runMcpTool(
					"context7",
					mcp.servers.context7,
					"get_finance_color_trends",
					{ year: 2026 },
				)) as TrendInfo;
				if (result?.data?.recommended_palette) {
					AgentLogger.info(
						this.name,
						"RUN",
						"MCP_TREND",
						"Overriding palette with 2026 CTR trends",
					);
					palette = {
						...palette,
						...result.data.recommended_palette,
						background_color:
							result.data.recommended_palette.background_color || "#103766",
						title_color:
							result.data.recommended_palette.title_color || "#FFFFFF",
					};
				}
			}
			const bgPath = path.join(this.store.runDir, "media", "generated_bg.png");
			if (fs.existsSync(bgPath)) fs.removeSync(bgPath);
			AgentLogger.info(this.name, "RUN", "THUMB_AI", "Generating thumbnail");
			const thumbPlan = await this.layout.createThumbnailRenderPlan();
			await this.layout.renderThumbnail(thumbPlan, title, thumbnail_path);
			const result = await this.validator.validate(
				thumbnail_path,
				(palette as unknown as Record<string, string>).text ||
				(palette as unknown as Record<string, string>).title_color ||
				"#FFFFFF",
				(palette as unknown as Record<string, string>).background ||
				(palette as unknown as Record<string, string>).background_color ||
				"#000000",
				title,
				this.thumbConfig.right_guard_band_px ?? 850,
			);
			if (!result.passed)
				throw new Error(`Asset quality rejection: ${result.reason}`);
			AgentLogger.info(this.name, "RUN", "IQA_PASSED", "Thumbnail verified");
		}
		const video_path = path.join(
			this.store.videoDir(),
			this.store.cfg.workflow.filenames.video,
		);
		await this.generateVideo(
			fullAudio,
			thumbnail_path,
			subtitlePath,
			video_path,
			videoPlan,
		);
		this.logOutput({
			audio_paths,
			thumbnail_path,
			video_path,
			subtitle_path: subtitlePath,
		});
		return {
			audio_paths,
			thumbnail_path,
			video_path,
			subtitle_path: subtitlePath,
		};
	}
	private getAudioDuration(p: string): Promise<number> {
		return new Promise((resolve, reject) =>
			ffmpeg.ffprobe(p, (err, m) =>
				err ? reject(err) : resolve(m?.format?.duration || 0),
			),
		);
	}
	private generateVideo(
		audioPath: string,
		thumbPath: string,
		subtitlePath: string,
		outputPath: string,
		plan: RenderPlan,
	): Promise<void> {
		const resParts = this.videoConfig.resolution.split("x");
		const w = resParts[0] || "1920";
		const h = resParts[1] || "1080";
		const fps = this.videoConfig.fps;
		const bgColor = this.videoConfig.background_color || "#103766";
		const introSec = this.videoConfig.intro_seconds || 5;
		return new Promise((resolve, reject) => {
			const cmd = ffmpeg();
			cmd
				.input(`color=c=${bgColor}:s=${w}x${h}:r=${fps}`)
				.inputFormat("lavfi")
				.input(audioPath);
			const filters: string[] = [];
			let lastStream = "0:v";
			let idx = 2;
			for (const ol of plan.overlays) {
				cmd.input(ol.resolvedPath);
				filters.push(
					`[${idx}:v]scale=${ol.bounds.width}:${ol.bounds.height}[sc${idx}]`,
				);
				filters.push(
					`[${lastStream}][sc${idx}]overlay=x=${ol.bounds.x}:y=${ol.bounds.y}[v${idx}]`,
				);
				lastStream = `v${idx}`;
				idx++;
			}
			if (
				this.videoConfig.thumbnail_overlay?.enabled &&
				thumbPath &&
				fs.existsSync(thumbPath)
			) {
				cmd.input(thumbPath);
				filters.push(
					`[${idx}:v]scale=${w}:${h}[thumb]`,
					`[${lastStream}][thumb]overlay=0:0:enable='lte(t,${introSec})'[v_thumb]`,
				);
				lastStream = "v_thumb";
				idx++;
			}
			const fontsDir = this.videoConfig.subtitles?.font_path
				? path.dirname(path.resolve(this.videoConfig.subtitles.font_path))
				: "";
			filters.push(
				`[${lastStream}]subtitles=${subtitlePath}${fontsDir ? `:fontsdir=${fontsDir}` : ""}[outv]`,
			);
			cmd.complexFilter(filters);
			cmd.outputOptions([
				"-map",
				"[outv]",
				"-map",
				"1:a",
				"-shortest",
				"-c:v",
				this.videoConfig.codec || "libx264",
				"-pix_fmt",
				"yuv420p",
			]);
			cmd
				.save(outputPath)
				.on("end", () => resolve())
				.on("error", reject);
		});
	}
	private cleanScriptText(text: string): string {
		return text
			.replace(/https?:\/\/[^\s]+/g, "")
			.replace(/\[.*?\]\((.*?)\)/g, "$1")
			.replace(/source_ref:.*$/gm, "")
			.replace(/\s+/g, " ")
			.trim();
	}
}
