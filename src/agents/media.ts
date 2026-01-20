import path from "path";
import os from "os";
import fs from "fs-extra";
import axios from "axios";
import ffmpeg from "fluent-ffmpeg";
import { AssetStore, loadConfig, getSpeakers, resolvePath } from "../core.js";
import { Script } from "../types.js";
import { LayoutEngine, RenderPlan } from "../layout_engine.js";

export interface MediaResult { audio_paths: string[]; thumbnail_path: string; video_path: string; subtitle_path: string; }

export class MediaAgent {
    store: AssetStore;
    ttsUrl: string;
    speakers: Record<string, number>;
    videoConfig: any;
    thumbConfig: any;
    subtitleConfig: any;
    layout: LayoutEngine;

    constructor(store: AssetStore) {
        const cfg = loadConfig();
        this.store = store;
        this.ttsUrl = cfg.providers.tts.voicevox.url;
        this.speakers = getSpeakers();
        this.videoConfig = cfg.steps.video;
        this.thumbConfig = cfg.steps.thumbnail;
        this.subtitleConfig = cfg.steps.subtitle;
        this.layout = new LayoutEngine();
    }

    async run(script: Script, title: string): Promise<MediaResult> {
        this.store.logInput("media", { lines: script.lines.length });
        const audioDir = this.store.audioDir();

        // 1. Generate Audio
        const audio_paths = await Promise.all(script.lines.map(async (l: any, i: number) => {
            const speakerId = this.speakers[l.speaker];
            if (speakerId === undefined) throw new Error(`Unknown speaker: ${l.speaker}`);
            const q = await axios.post(`${this.ttsUrl}/audio_query`, null, { params: { text: l.text, speaker: speakerId } });
            const s = await axios.post(`${this.ttsUrl}/synthesis`, q.data, { params: { speaker: speakerId }, responseType: 'arraybuffer' });
            const p = path.join(audioDir, `${String(i).padStart(3, '0')}.wav`);
            fs.writeFileSync(p, Buffer.from(s.data));
            return p;
        }));

        const fullAudio = path.join(audioDir, "full.wav");

        // 2. Prepare Layout & Subtitles
        const videoPlan = await this.layout.createVideoRenderPlan();

        const durations = [];
        const audioCmd = ffmpeg();

        for (let i = 0; i < audio_paths.length; i++) {
            audioCmd.input(audio_paths[i]);
            durations.push(await this.getAudioDuration(audio_paths[i]));
        }

        const assContent = this.layout.generateASS(script, durations, videoPlan);
        const subtitlePath = path.join(this.store.runDir, "subtitles.ass");
        fs.writeFileSync(subtitlePath, assContent);

        await new Promise<void>((res, rej) => audioCmd.on('error', rej).on('end', () => res()).mergeToFile(fullAudio, os.tmpdir()));

        // 3. Generate Visuals
        const thumbnail_path = path.join(this.store.runDir, "thumbnail.png");
        const thumbPlan = await this.layout.createThumbnailRenderPlan();
        await this.layout.renderThumbnail(thumbPlan, title, thumbnail_path);

        const video_path = path.join(this.store.videoDir(), "video.mp4");
        await this.generateVideo(fullAudio, thumbnail_path, subtitlePath, video_path, videoPlan);

        this.store.logOutput("media", { audio_paths, thumbnail_path, video_path, subtitle_path: subtitlePath });
        return { audio_paths, thumbnail_path, video_path, subtitle_path: subtitlePath };
    }

    private getAudioDuration(p: string): Promise<number> {
        return new Promise((resolve, reject) => ffmpeg.ffprobe(p, (err, m) => err ? reject(err) : resolve(m.format.duration || 0)));
    }

    private generateVideo(audioPath: string, thumbPath: string, subtitlePath: string, outputPath: string, plan: RenderPlan): Promise<void> {
        const [w, h] = this.videoConfig.resolution.split("x");
        const fps = this.videoConfig.fps;
        const introSec = this.videoConfig.thumbnail_overlay?.duration_seconds || 5;

        return new Promise((resolve, reject) => {
            const cmd = ffmpeg();
            cmd.input(`color=c=0x193d5a:s=${w}x${h}:r=${fps}`).inputFormat("lavfi");
            cmd.input(audioPath);

            const filters: string[] = [];
            let lastStream = "0:v", idx = 2; // 0:bg, 1:audio

            // Overlays from Plan
            for (const ol of plan.overlays) {
                cmd.input(ol.resolvedPath);
                // Scale explicitly to calculated bounds
                filters.push(`[${idx}:v]scale=${ol.bounds.width}:${ol.bounds.height}[sc${idx}]`);
                // Overlay at calculated x:y
                filters.push(`[${lastStream}][sc${idx}]overlay=x=${ol.bounds.x}:y=${ol.bounds.y}[v${idx}]`);
                lastStream = `v${idx}`;
                idx++;
            }

            // Thumbnail Overlay (Intro)
            cmd.input(thumbPath);
            filters.push(`[${idx}:v]scale=${w}:${h}[thumb]`, `[${lastStream}][thumb]overlay=0:0:enable='lte(t,${introSec})'[v_thumb]`);
            lastStream = `v_thumb`;

            // Subtitles
            const fontsDir = this.videoConfig.subtitles?.font_path ? path.dirname(path.resolve(this.videoConfig.subtitles.font_path)) : '';
            filters.push(`[${lastStream}]subtitles=${subtitlePath}${fontsDir ? `:fontsdir=${fontsDir}` : ''}[outv]`);

            cmd.complexFilter(filters);
            cmd.outputOptions(["-map", "[outv]", "-map", "1:a", "-shortest", "-c:v", this.videoConfig.codec || "libx264", "-pix_fmt", "yuv420p"]);
            cmd.save(outputPath).on("end", () => resolve()).on("error", reject);
        });
    }
}
