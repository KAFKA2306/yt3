
import path from "path";
import fs from "fs-extra";
import yaml from "js-yaml";
import { ROOT } from "./config.js";

export class AssetStore {
    runDir: string;

    constructor(runId: string) {
        this.runDir = path.join(ROOT, "runs", runId);
        fs.ensureDirSync(this.runDir);
    }

    loadState(): any {
        const p = path.join(this.runDir, "state.json");
        return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : {};
    }

    updateState(update: any): void {
        const state = this.loadState();
        const newState = { ...state, ...update };
        fs.writeFileSync(path.join(this.runDir, "state.json"), JSON.stringify(newState, null, 2));
    }

    save(stage: string, name: string, data: any): string {
        const stageDir = path.join(this.runDir, stage);
        fs.ensureDirSync(stageDir);
        const p = path.join(stageDir, `${name}.yaml`);
        fs.writeFileSync(p, yaml.dump(data));
        return p;
    }

    load(stage: string, name: string): any {
        const p = path.join(this.runDir, stage, `${name}.yaml`);
        return yaml.load(fs.readFileSync(p, "utf8"));
    }

    saveBinary(stage: string, name: string, data: Buffer): string {
        const stageDir = path.join(this.runDir, stage);
        fs.ensureDirSync(stageDir);
        const p = path.join(stageDir, name);
        fs.writeFileSync(p, data);
        return p;
    }

    logInput(stage: string, data: any): void {
        this.save(stage, "input", data);
    }

    logOutput(stage: string, data: any): void {
        this.save(stage, "output", data);
    }

    audioDir(): string {
        const d = path.join(this.runDir, "audio");
        fs.ensureDirSync(d);
        return d;
    }

    videoDir(): string {
        const d = path.join(this.runDir, "video");
        fs.ensureDirSync(d);
        return d;
    }
}
