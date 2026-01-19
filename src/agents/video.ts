
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
        const videoCfg = cfg.steps.video;
        this.resolution = videoCfg.resolution;
        this.fps = videoCfg.fps;
        this.codec = videoCfg.codec;
    }

    async run(audioPaths: string[], thumbnailPath: string): Promise<string> {
        this.store.logInput("video", { audioPaths, thumbnailPath });
        const audioDir = this.store.audioDir();
        const videoDir = this.store.videoDir();
        const audioPath = path.join(audioDir, "full_audio.wav");
        const outputPath = path.join(videoDir, "video.mp4");
        const [width, height] = this.resolution.split("x");

        const cmd = ffmpeg()
            .input(`color=c=black:s=${width}x${height}:r=${this.fps}`)
            .inputFormat("lavfi")
            .input(audioPath);

        [thumbnailPath].filter(p => Boolean(p)).map(p => cmd.input(p));

        const filters = [
            `[0:v]copy[v]`
        ];
        [thumbnailPath].filter(p => Boolean(p)).map(() => {
            filters.length = 0;
            filters.push(`[2:v]scale=${width}:${height}[thumb]`);
            filters.push(`[0:v][thumb]overlay=0:0:enable='lte(t,5)'[v]`);
        });

        return new Promise((resolve, reject) => {
            cmd.complexFilter(filters)
                .outputOptions([
                    "-map", "[v]",
                    "-map", "1:a",
                    "-shortest",
                    "-c:v", this.codec,
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac"
                ])
                .save(outputPath)
                .on("end", () => {
                    this.store.logOutput("video", { path: outputPath, status: "completed" });
                    resolve(outputPath);
                })
                .on("error", (err) => {
                    reject(err);
                });
        });
    }
}
