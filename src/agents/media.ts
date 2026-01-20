
import path from "path";
import fs from "fs-extra";
import axios from "axios";
import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp";
import os from "os";
import { AssetStore } from "../asset.js";
import { loadConfig, getSpeakers } from "../config.js";
import { Script } from "../models.js";

interface Palette {
    background_color: string;
    title_color: string;
    outline_inner_color: string;
    outline_inner_width: number;
    outline_outer_color: string;
    outline_outer_width: number;
    subtitle_color?: string;
}

export interface MediaResult {
    audio_paths: string[];
    thumbnail_path: string;
    video_path: string;
}

export class MediaAgent {
    store: AssetStore;
    ttsUrl: string;
    speakers: Record<string, number>;
    videoConfig: any;
    thumbConfig: any;

    constructor(store: AssetStore) {
        this.store = store;
        const cfg = loadConfig();
        this.ttsUrl = cfg.providers.tts.voicevox.url;
        this.speakers = getSpeakers();
        this.videoConfig = cfg.steps.video;
        this.thumbConfig = cfg.steps.thumbnail;
    }

    // === AUDIO ===
    async synthesizeAudio(script: Script): Promise<string[]> {
        const audioDir = this.store.audioDir();
        const paths: string[] = [];

        for (let i = 0; i < script.lines.length; i++) {
            const line = script.lines[i];
            const spkId = this.speakers[line.speaker];
            console.log(`[Media] Audio ${i}: ${line.speaker}`);

            const q = await axios.post(`${this.ttsUrl}/audio_query`, null, { params: { text: line.text, speaker: spkId } });
            const s = await axios.post(`${this.ttsUrl}/synthesis`, q.data, { params: { speaker: spkId }, responseType: 'arraybuffer' });

            const filePath = path.join(audioDir, `${String(i).padStart(3, '0')}_${line.speaker}.wav`);
            fs.writeFileSync(filePath, Buffer.from(s.data));
            paths.push(filePath);
        }

        // Merge
        const fullPath = path.join(audioDir, "full_audio.wav");
        await this.mergeAudio(paths, fullPath);
        return paths;
    }

    async mergeAudio(inputs: string[], output: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const cmd = ffmpeg();
            inputs.forEach(i => cmd.input(i));
            cmd.on('error', reject).on('end', () => resolve()).mergeToFile(output, os.tmpdir());
        });
    }

    // === THUMBNAIL ===
    async generateThumbnail(title: string, subtitle: string = ""): Promise<string> {
        const palette: Palette = this.thumbConfig.palettes[Math.floor(Math.random() * this.thumbConfig.palettes.length)];
        const { width, height } = this.thumbConfig;

        const canvas = sharp({ create: { width, height, channels: 4, background: palette.background_color } });
        const svg = this.createThumbnailSvg(title, subtitle, palette);
        const composition: any[] = [{ input: Buffer.from(svg), top: 0, left: 0 }];

        for (const ov of this.thumbConfig.overlays.filter((o: any) => o.enabled)) {
            const h = ov.height || Math.floor(height * (ov.height_ratio || 0.85));
            const ovImg = await sharp(ov.image_path).resize({ height: h }).toBuffer();
            const meta = await sharp(ovImg).metadata();
            const iw = meta.width || 0, ih = meta.height || 0;

            const anchors: Record<string, { top: number; left: number }> = {
                "bottom_right": { top: height - ih - (ov.offset?.bottom || 0), left: width - iw - (ov.offset?.right || 0) },
                "top_right": { top: ov.offset?.top || 0, left: width - iw - (ov.offset?.right || 0) },
                "bottom_left": { top: height - ih - (ov.offset?.bottom || 0), left: ov.offset?.left || 0 },
                "top_left": { top: ov.offset?.top || 0, left: ov.offset?.left || 0 }
            };
            const pos = anchors[ov.anchor as string] || { top: 0, left: 0 };
            composition.push({ input: ovImg, ...pos });
        }

        const outPath = path.join(this.store.runDir, "thumbnail.png");
        await canvas.composite(composition).png().toFile(outPath);
        return outPath;
    }

    createThumbnailSvg(title: string, subtitle: string, palette: Palette): string {
        const { width, height, padding, title_font_size, max_chars_per_line, max_lines } = this.thumbConfig;
        const lines = title.includes("\n") ? title.split("\n").slice(0, max_lines) : this.chunk(title, max_chars_per_line, max_lines);
        const startY = (height - lines.length * title_font_size) / 2 + title_font_size * 0.8;
        const spans = lines.map((l, i) => `<tspan x="${padding}" dy="${i === 0 ? 0 : title_font_size}">${l}</tspan>`).join("");

        return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <style>.t { font-family: sans-serif; font-size: ${title_font_size}px; font-weight: bold; fill: ${palette.title_color}; stroke: ${palette.outline_outer_color}; stroke-width: ${palette.outline_outer_width}px; paint-order: stroke fill; }</style>
            <text x="${padding}" y="${startY}" class="t">${spans}</text>
        </svg>`;
    }

    chunk(text: string, size: number, max: number): string[] {
        const r: string[] = [];
        for (let i = 0; i < text.length && r.length < max; i += size) r.push(text.slice(i, i + size));
        return r;
    }

    // === VIDEO ===
    async encodeVideo(thumbnailPath: string): Promise<string> {
        const audioPath = path.join(this.store.audioDir(), "full_audio.wav");
        const outputPath = path.join(this.store.videoDir(), "video.mp4");
        const [w, h] = this.videoConfig.resolution.split("x");

        return new Promise((resolve, reject) => {
            ffmpeg()
                .input(`color=c=black:s=${w}x${h}:r=${this.videoConfig.fps}`).inputFormat("lavfi")
                .input(audioPath)
                .input(thumbnailPath)
                .complexFilter([`[2:v]scale=${w}:${h}[thumb]`, `[0:v][thumb]overlay=0:0:enable='lte(t,5)'[v]`])
                .outputOptions(["-map", "[v]", "-map", "1:a", "-shortest", "-c:v", this.videoConfig.codec, "-pix_fmt", "yuv420p", "-c:a", "aac"])
                .save(outputPath)
                .on("end", () => resolve(outputPath))
                .on("error", reject);
        });
    }

    // === MAIN RUN ===
    async run(script: Script, thumbnailTitle: string): Promise<MediaResult> {
        this.store.logInput("media", { script_lines: script.lines.length });

        console.log("[Media] Generating audio...");
        const audio_paths = await this.synthesizeAudio(script);

        console.log("[Media] Generating thumbnail...");
        const thumbnail_path = await this.generateThumbnail(thumbnailTitle);

        console.log("[Media] Encoding video...");
        const video_path = await this.encodeVideo(thumbnail_path);

        this.store.logOutput("media", { audio_paths, thumbnail_path, video_path });
        return { audio_paths, thumbnail_path, video_path };
    }
}
