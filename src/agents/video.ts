
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import { AssetStore } from "../asset.js";
import { loadConfig } from "../config.js";

export class VideoAgent {
    store: AssetStore;
    resolution: string;
    fps: number;
    codec: string;

    constructor(store: AssetStore) {
        this.store = store;
        const cfg = loadConfig();
        const videoCfg = cfg.steps?.video || {};
        this.resolution = videoCfg.resolution || "1920x1080";
        this.fps = videoCfg.fps || 25;
        this.codec = videoCfg.codec || "libx264";
    }

    async run(audioPaths: string[]): Promise<string> {
        this.store.logInput("video", { audioPaths });

        const audioDir = this.store.audioDir();
        const videoDir = this.store.videoDir();
        const audioPath = path.join(audioDir, "full_audio.wav");
        const outputPath = path.join(videoDir, "video.mp4");

        const [width, height] = this.resolution.split("x");

        return new Promise((resolve, reject) => {
            ffmpeg()
                .input(`color=c=black:s=${width}x${height}:r=${this.fps}`)
                .inputFormat("lavfi")
                .input(audioPath)
                .outputOptions([
                    "-shortest",
                    "-c:v", this.codec,
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac"
                ])
                .save(outputPath)
                .on('end', () => {
                    this.store.logOutput("video", { path: outputPath, status: "completed" });
                    resolve(outputPath);
                })
                .on('error', (err) => {
                    reject(err);
                });
        });
    }
}
