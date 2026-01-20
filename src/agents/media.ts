import path from "path";
import fs from "fs-extra";
import axios from "axios";
import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp";
import os from "os";
import { AssetStore } from "../asset.js";
import { loadConfig, getSpeakers } from "../config.js";
import { Script } from "../models.js";

export interface MediaResult { audio_paths: string[]; thumbnail_path: string; video_path: string; subtitle_path: string; }

interface OverlayConfig {
    type: string;
    enabled: boolean;
    image_path: string;
    anchor?: string;
    offset?: { top?: number; bottom?: number; left?: number; right?: number };
    width?: number;
    height?: number;
    height_ratio?: number;
    width_ratio?: number;
}

export class MediaAgent {
    store: AssetStore;
    ttsUrl: string;
    speakers: Record<string, number>;
    videoConfig: any;
    thumbConfig: any;
    subtitleConfig: any;

    constructor(store: AssetStore) {
        const cfg = loadConfig();
        this.store = store;
        this.ttsUrl = cfg.providers.tts.voicevox.url;
        this.speakers = getSpeakers();
        this.videoConfig = cfg.steps.video;
        this.thumbConfig = cfg.steps.thumbnail;
        this.subtitleConfig = cfg.steps.subtitle;
    }

    async run(script: Script, title: string): Promise<MediaResult> {
        this.store.logInput("media", { lines: script.lines.length });
        const audioDir = this.store.audioDir();

        const audio_paths = await Promise.all(script.lines.map(async (l, i) => {
            const speakerId = this.speakers[l.speaker];
            if (speakerId === undefined) throw new Error(`Unknown speaker: ${l.speaker}`);
            const q = await axios.post(`${this.ttsUrl}/audio_query`, null, { params: { text: l.text, speaker: speakerId } });
            const s = await axios.post(`${this.ttsUrl}/synthesis`, q.data, { params: { speaker: speakerId }, responseType: 'arraybuffer' });
            const p = path.join(audioDir, `${String(i).padStart(3, '0')}.wav`);
            fs.writeFileSync(p, Buffer.from(s.data));
            return p;
        }));

        const fullAudio = path.join(audioDir, "full.wav");
        const subtitlePath = path.join(this.store.runDir, "subtitles.srt");
        let currentTime = 0, srtContent = "";
        const audioCmd = ffmpeg();

        for (let i = 0; i < audio_paths.length; i++) {
            audioCmd.input(audio_paths[i]);
            const duration = await this.getAudioDuration(audio_paths[i]);
            srtContent += `${i + 1}\n${this.formatSrtTime(currentTime)} --> ${this.formatSrtTime(currentTime + duration)}\n${script.lines[i].text}\n\n`;
            currentTime += duration;
        }
        fs.writeFileSync(subtitlePath, srtContent);
        await new Promise<void>((res, rej) => audioCmd.on('error', rej).on('end', () => res()).mergeToFile(fullAudio, os.tmpdir()));

        const { safeMarginL, safeMarginR } = this.calculateSafeMargins();
        const thumbnail_path = path.join(this.store.runDir, "thumbnail.png");
        await this.generateThumbnail(title, thumbnail_path);
        const video_path = path.join(this.store.videoDir(), "video.mp4");
        await this.generateVideo(fullAudio, thumbnail_path, subtitlePath, video_path, safeMarginL, safeMarginR);

        this.store.logOutput("media", { audio_paths, thumbnail_path, video_path, subtitle_path: subtitlePath });
        return { audio_paths, thumbnail_path, video_path, subtitle_path: subtitlePath };
    }

    private getAudioDuration(p: string): Promise<number> {
        return new Promise((resolve, reject) => ffmpeg.ffprobe(p, (err, m) => err ? reject(err) : resolve(m.format.duration || 0)));
    }

    private formatSrtTime(s: number): string {
        return new Date(s * 1000).toISOString().substr(11, 12).replace('.', ',');
    }

    private calculateSafeMargins(): { safeMarginL: number; safeMarginR: number } {
        const effects: OverlayConfig[] = this.videoConfig.effects || [];
        const [width, height] = this.videoConfig.resolution.split("x").map(Number);
        let safeMarginL = this.subtitleConfig?.margin_l || 0;
        let safeMarginR = this.subtitleConfig?.margin_r || 0;

        for (const e of effects) {
            if (e.type !== 'overlay' || !e.enabled) continue;
            const overlayW = e.width || (e.width_ratio ? width * e.width_ratio : (e.height_ratio ? height * e.height_ratio * 0.5 : 300));
            if (e.anchor?.includes("left")) safeMarginL = Math.max(safeMarginL, (e.offset?.left || 0) + overlayW + 20);
            else if (e.anchor?.includes("right")) safeMarginR = Math.max(safeMarginR, (e.offset?.right || 0) + overlayW + 20);
        }

        const minWidth = width * 0.3;
        if (width - safeMarginL - safeMarginR < minWidth) {
            const reduce = (minWidth - (width - safeMarginL - safeMarginR)) / 2;
            safeMarginL = Math.max(0, safeMarginL - reduce);
            safeMarginR = Math.max(0, safeMarginR - reduce);
        }
        return { safeMarginL, safeMarginR };
    }

    private async generateThumbnail(title: string, outputPath: string): Promise<void> {
        const { width, height, title_font_size, palettes, overlays } = this.thumbConfig;
        const palette = palettes[0];
        const composites: sharp.OverlayOptions[] = [];

        if (overlays) {
            for (const ol of overlays) {
                if (!ol.enabled || !fs.existsSync(ol.image_path)) continue;
                const img = sharp(ol.image_path);
                const meta = await img.metadata();
                if (!meta.width || !meta.height) continue;
                let targetH = ol.height_ratio ? Math.round(height * ol.height_ratio) : (ol.height || meta.height);
                let targetW = Math.round(meta.width * (targetH / meta.height));
                const buf = await img.resize(targetW, targetH).toBuffer();
                const pos = this.calcPosition(ol.anchor, width, height, targetW, targetH, ol.offset);
                composites.push({ input: buf, ...pos });
            }
        }

        const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><style>.t{font-family:sans-serif;font-size:${title_font_size}px;font-weight:bold;fill:${palette.title_color};stroke:${palette.outline_outer_color};stroke-width:${palette.outline_outer_width}px;paint-order:stroke fill}</style><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" class="t">${title}</text></svg>`;
        composites.push({ input: Buffer.from(svg), top: 0, left: 0 });

        await sharp({ create: { width, height, channels: 4, background: palette.background_color } }).composite(composites).png().toFile(outputPath);
    }

    private calcPosition(anchor: string, W: number, H: number, w: number, h: number, offset: any = {}): { top: number; left: number } {
        let top = 0, left = 0;
        if (anchor?.includes('bottom')) top = H - h - (offset.bottom || 0);
        else top = offset.top || 0;
        if (anchor?.includes('right')) left = W - w - (offset.right || 0);
        else left = offset.left || 0;
        return { top: Math.max(0, Math.round(top)), left: Math.max(0, Math.round(left)) };
    }

    private generateVideo(audioPath: string, thumbPath: string, subtitlePath: string, outputPath: string, marginL: number, marginR: number): Promise<void> {
        const [w, h] = this.videoConfig.resolution.split("x");
        const fps = this.videoConfig.fps;
        const introSec = this.videoConfig.thumbnail_overlay?.duration_seconds || 5;

        return new Promise((resolve, reject) => {
            const cmd = ffmpeg();
            cmd.input(`color=c=black:s=${w}x${h}:r=${fps}`).inputFormat("lavfi");
            cmd.input(audioPath);


            const filters: string[] = [];
            let lastStream = "0:v", idx = 2;

            for (const e of (this.videoConfig.effects || []) as OverlayConfig[]) {
                if (e.type !== 'overlay' || !e.enabled || !fs.existsSync(e.image_path)) continue;
                cmd.input(e.image_path);
                const scaleH = e.height_ratio ? Math.round(Number(h) * e.height_ratio) : -1;
                const x = e.anchor?.includes("right") ? `W-w-${e.offset?.right || 0}` : (e.anchor?.includes("left") ? `${e.offset?.left || 0}` : "(W-w)/2");
                const y = e.anchor?.includes("bottom") ? `H-h-${e.offset?.bottom || 0}` : "0";
                filters.push(`[${idx}:v]scale=-1:${scaleH}[sc${idx}]`, `[${lastStream}][sc${idx}]overlay=x=${x}:y=${y}[v${idx}]`);
                lastStream = `v${idx}`;
                idx++;
            }

            cmd.input(thumbPath);
            filters.push(`[${idx}:v]scale=${w}:${h}[thumb]`, `[${lastStream}][thumb]overlay=0:0:enable='lte(t,${introSec})'[v_thumb]`);
            lastStream = `v_thumb`;

            const sub = this.videoConfig.subtitles || {};
            const style = [`FontName=${sub.font_name || 'Arial'}`, `FontSize=${sub.font_size || 24}`, `PrimaryColour=${sub.primary_colour || '&HFFFFFF&'}`, `OutlineColour=${sub.outline_colour || '&H000000&'}`, `Outline=${sub.outline || 1}`, `Shadow=${sub.shadow || 0}`, `Alignment=${sub.alignment || 2}`, `MarginL=${marginL}`, `MarginR=${marginR}`, `MarginV=${sub.margin_v || 10}`].join(',');
            const fontsDir = sub.font_path ? path.dirname(path.resolve(sub.font_path)) : '';
            filters.push(`[${lastStream}]subtitles=${subtitlePath}:force_style='${style}'${fontsDir ? `:fontsdir=${fontsDir}` : ''}[outv]`);

            cmd.complexFilter(filters, ["outv", "1:a"]);
            cmd.outputOptions(["-map", "[outv]", "-map", "1:a", "-shortest", "-c:v", this.videoConfig.codec || "libx264", "-pix_fmt", "yuv420p"]);
            cmd.save(outputPath).on("end", () => resolve()).on("error", reject);
        });
    }
}
