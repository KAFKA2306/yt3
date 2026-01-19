
import path from "path";
import fs from "fs-extra";
import axios from "axios";
import ffmpeg from "fluent-ffmpeg";
import { AssetStore } from "../asset.js";
import { loadConfig, getSpeakers } from "../config.js";
import { Script } from "../models.js";
import os from "os";

export class AudioAgent {
    store: AssetStore;
    baseUrl: string;
    speakers: Record<string, number>;

    constructor(store: AssetStore) {
        this.store = store;
        const cfg = loadConfig();
        this.baseUrl = cfg.providers.tts.voicevox.url;
        this.speakers = getSpeakers();
    }

    async run(script: Script): Promise<string[]> {
        this.store.logInput("audio", script);

        const audioDir = this.store.audioDir();
        const audioPaths: string[] = [];

        for (let i = 0; i < script.lines.length; i++) {
            const line = script.lines[i];
            const spkId = this.speakers[line.speaker] || 1;
            const text = line.text;

            const q = await axios.post(`${this.baseUrl}/audio_query`, null, {
                params: { text: text, speaker: spkId }
            });
            const qData = q.data;

            const s = await axios.post(`${this.baseUrl}/synthesis`, qData, {
                params: { speaker: spkId },
                responseType: 'arraybuffer'
            });

            const fileName = `${String(i).padStart(3, '0')}_${line.speaker}.wav`;
            const filePath = path.join(audioDir, fileName);
            fs.writeFileSync(filePath, Buffer.from(s.data));
            audioPaths.push(filePath);
        }

        if (audioPaths.length > 0) {
            const fullPath = path.join(audioDir, "full_audio.wav");
            await this.mergeAudio(audioPaths, fullPath);
            this.store.logOutput("audio", { paths: audioPaths, full: fullPath });
        }

        return audioPaths;
    }

    async mergeAudio(inputs: string[], output: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const cmd = ffmpeg();
            inputs.forEach(i => cmd.input(i));

            cmd.on('error', (err) => {
                reject(err);
            })
                .on('end', () => {
                    resolve();
                })
                .mergeToFile(output, os.tmpdir());
        });
    }
}
