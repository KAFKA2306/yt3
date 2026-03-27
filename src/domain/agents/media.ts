import os from "node:os";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs-extra";

import {
	AgentLogger,
	type AssetStore,
	BaseAgent,
	RunStage,
	loadConfig,
} from "../../io/core.js";
import { TtsOrchestrator } from "../../io/utils/tts_orchestrator.js";
import { IqaValidator } from "../../io/utils/iqa_validator.js";
import { LayoutEngine, type RenderPlan } from "../layout_engine.js";
import { VideoComposer } from "../media/video_composer.js";
import { ThumbnailGenerator } from "../media/thumbnail_generator.js";
import type { AppConfig, Script } from "../types.js";
export interface MediaResult {
	audio_paths: string[];
	thumbnail_path: string;
	video_path: string;
	subtitle_path: string;
}

export class VisualDirector extends BaseAgent {
	private ttsOrchestrator: TtsOrchestrator;
	private videoComposer: VideoComposer;
	private thumbnailGenerator: ThumbnailGenerator;
	private layout: LayoutEngine;
	private validator: IqaValidator;
	private videoConfig: AppConfig["steps"]["video"];
	private speakers: Record<string, number>;

	constructor(store: AssetStore) {
		const cfg = loadConfig();
		super(store, RunStage.MEDIA, {
			temperature: cfg.providers.llm.media?.temperature || 0.1,
		});

		this.speakers = cfg.providers.tts.voicevox.speakers;
		this.videoConfig = cfg.steps.video;
		this.layout = new LayoutEngine();
		this.validator = new IqaValidator(cfg);

		this.ttsOrchestrator = new TtsOrchestrator({
			ttsUrl: cfg.providers.tts.voicevox.url,
			speakers: cfg.providers.tts.voicevox.speakers,
			defaultSpeaker: 11,
			timeout: {
				query: 30000,
				synthesis: 120000,
			},
		});

		this.videoComposer = new VideoComposer({
			resolution: cfg.steps.video.resolution,
			fps: cfg.steps.video.fps,
			codec: cfg.steps.video.codec,
			background_color: cfg.steps.video.background_color,
			intro_seconds: cfg.steps.video.intro_seconds,
			thumbnail_overlay: cfg.steps.video.thumbnail_overlay,
			subtitles: cfg.steps.video.subtitles,
		});

		this.thumbnailGenerator = new ThumbnailGenerator({
			layout: this.layout,
			validator: this.validator,
			config: cfg.steps.thumbnail,
			mcpServers: cfg.mcp?.servers,
			agentName: this.name,
		});
	}
	async run(script: Script, title: string): Promise<MediaResult> {
		this.logInput({ lines: script.lines.length });
		const audioDir = this.store.audioDir();
		const audio_paths = await this.synthesizeAudio(script, audioDir);

		const videoPlan = await this.layout.createVideoRenderPlan();
		const durations = await this.getAudioDurations(audio_paths);
		const subtitlePath = await this.generateSubtitles(
			script,
			durations,
			videoPlan,
		);

		const fullAudio = await this.mergeAudio(audio_paths, audioDir);

		const thumbnail_path = await this.thumbnailGenerator.generate(
			title,
			path.join(
				this.store.runDir,
				this.store.cfg.workflow.filenames.thumbnail,
			),
		);

		const video_path = path.join(
			this.store.videoDir(),
			this.store.cfg.workflow.filenames.video,
		);

		await this.videoComposer.compose(
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
	private async synthesizeAudio(
		script: Script,
		audioDir: string,
	): Promise<string[]> {
		const audio_paths: string[] = [];

		for (let i = 0; i < script.lines.length; i++) {
			const line = script.lines[i];
			if (!line) continue;

			const audioPath = path.join(
				audioDir,
				`${String(i).padStart(3, "0")}.wav`,
			);

			if (fs.existsSync(audioPath)) {
				audio_paths.push(audioPath);
				continue;
			}

			if (!this.ttsOrchestrator.isSpeakerValid(line.speaker)) {
				AgentLogger.warn(
					this.name,
					"RUN",
					"UNKNOWN_SPEAKER",
					`Fallback to default speaker for: ${line.speaker}`,
				);
			}

			const cleanText = this.cleanScriptText(line.text);
			AgentLogger.info(
				this.name,
				"TTS",
				"GENERATE",
				`[${i + 1}/${script.lines.length}] ${line.speaker}: ${cleanText.slice(0, 30)}...`,
			);

			const speakerId = this.speakers[line.speaker] || 11;
			const audioBuffer = await this.ttsOrchestrator.synthesize({
				text: cleanText,
				speaker: speakerId,
			});

			fs.writeFileSync(audioPath, audioBuffer);
			audio_paths.push(audioPath);
		}

		return audio_paths;
	}

	private async getAudioDurations(
		audioPaths: string[],
	): Promise<number[]> {
		const durations: number[] = [];
		for (const audioPath of audioPaths) {
			const duration = await this.getAudioDuration(audioPath);
			durations.push(duration);
		}
		return durations;
	}

	private getAudioDuration(audioPath: string): Promise<number> {
		return new Promise((resolve, reject) =>
			ffmpeg.ffprobe(audioPath, (err, metadata) =>
				err
					? reject(err)
					: resolve(metadata?.format?.duration || 0),
			),
		);
	}

	private async generateSubtitles(
		script: Script,
		durations: number[],
		videoPlan: RenderPlan,
	): Promise<string> {
		const assContent = this.layout.generateASS(
			script,
			durations,
			videoPlan,
		);
		const subtitlePath = path.join(
			this.store.runDir,
			this.store.cfg.workflow.filenames.subtitles,
		);
		fs.writeFileSync(subtitlePath, assContent);
		return subtitlePath;
	}

	private async mergeAudio(
		audioPaths: string[],
		audioDir: string,
	): Promise<string> {
		const fullAudioPath = path.join(
			audioDir,
			this.store.cfg.workflow.filenames.audio_full,
		);

		const audioCmd = ffmpeg();
		for (const audioPath of audioPaths) {
			audioCmd.input(audioPath);
		}

		return new Promise((resolve, reject) => {
			audioCmd
				.on("error", reject)
				.on("end", () => resolve(fullAudioPath))
				.mergeToFile(fullAudioPath, os.tmpdir());
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
