import path from "path";
import fs from "fs-extra";
import axios from "axios";
import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp";
import os from "os";
import { AssetStore } from "../asset.js";
import { loadConfig, getSpeakers } from "../config.js";
import { Script } from "../models.js";

export interface MediaResult { audio_paths: string[]; thumbnail_path: string; video_path: string; }

export class MediaAgent {
    store: AssetStore;
    ttsUrl: string;
    speakers: Record<string, number>;
    videoConfig: any;
    thumbConfig: any;

    constructor(store: AssetStore) {
        const cfg = loadConfig();
        this.store = store;
        this.ttsUrl = cfg.providers.tts.voicevox.url;
        this.speakers = getSpeakers();
        this.videoConfig = cfg.steps.video;
        this.thumbConfig = cfg.steps.thumbnail;
    }

    async run(script: Script, title: string): Promise<MediaResult> {
        this.store.logInput("media", { lines: script.lines.length });
        const audioDir = this.store.audioDir();
        const audio_paths = await Promise.all(script.lines.map(async (l, i) => {
            const q = await axios.post(`${this.ttsUrl}/audio_query`, null, { params: { text: l.text, speaker: this.speakers[l.speaker] } });
            const s = await axios.post(`${this.ttsUrl}/synthesis`, q.data, { params: { speaker: this.speakers[l.speaker] }, responseType: 'arraybuffer' });
            const p = path.join(audioDir, `${String(i).padStart(3, '0')}.wav`);
            fs.writeFileSync(p, Buffer.from(s.data));
            return p;
        }));

        const fullAudio = path.join(audioDir, "full.wav");
        await new Promise((res, rej) => {
            const cmd = ffmpeg();
            audio_paths.forEach(p => cmd.input(p));
            cmd.on('error', rej).on('end', res).mergeToFile(fullAudio, os.tmpdir());
        });

        const { width, height, title_font_size, palettes } = this.thumbConfig;
        const palette = palettes[0];
        const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><style>.t { font-family: sans-serif; font-size: ${title_font_size}px; font-weight: bold; fill: ${palette.title_color}; stroke: ${palette.outline_outer_color}; stroke-width: ${palette.outline_outer_width}px; paint-order: stroke fill; }</style><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" class="t">${title}</text></svg>`;
        const thumbnail_path = path.join(this.store.runDir, "thumbnail.png");
        await sharp({ create: { width, height, channels: 4, background: palette.background_color } }).composite([{ input: Buffer.from(svg) }]).png().toFile(thumbnail_path);

        const video_path = path.join(this.store.videoDir(), "video.mp4");
        const [w, h] = this.videoConfig.resolution.split("x");
        await new Promise((res, rej) => {
            ffmpeg().input(`color=c=black:s=${w}x${h}:r=${this.videoConfig.fps}`).inputFormat("lavfi").input(fullAudio).input(thumbnail_path).complexFilter([`[2:v]scale=${w}:${h}[th]`, `[0:v][th]overlay=0:0:enable='lte(t,5)'[v]`]).outputOptions(["-map", "[v]", "-map", "1:a", "-shortest", "-c:v", this.videoConfig.codec, "-pix_fmt", "yuv420p"]).save(video_path).on("end", res).on("error", rej);
        });

        this.store.logOutput("media", { audio_paths, thumbnail_path, video_path });
        return { audio_paths, thumbnail_path, video_path };
    }
}
