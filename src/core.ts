
import path from "path";
import fs from "fs-extra";
import yaml from "js-yaml";
import dotenv from "dotenv";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState } from "./types.js";

dotenv.config({ path: path.join(process.cwd(), "config", ".env") });

export const ROOT = process.cwd();

export function readYamlFile<T>(filePath: string): T {
    try {
        if (!fs.existsSync(filePath)) return {} as T;
        return yaml.load(fs.readFileSync(filePath, "utf8")) as T;
    } catch (e) {
        console.error(`Failed to load YAML: ${filePath}`, e);
        return {} as T;
    }
}

export function cleanCodeBlock(text: any): string {
    const s = typeof text === "string" ? text : JSON.stringify(text);
    const match = s.match(/```(?:json|yaml|)\s*([\s\S]*?)\s*```/i);
    return (match ? match[1] : s).trim();
}

export function parseLlmJson<T>(text: any): T {
    try {
        return JSON.parse(cleanCodeBlock(text)) as T;
    } catch (e) {
        console.error("JSON Parse Error:", e);
        return {} as T;
    }
}

export function parseLlmYaml<T>(text: any): T {
    try {
        return yaml.load(cleanCodeBlock(text)) as T;
    } catch (e) {
        console.error("YAML Parse Error:", e);
        return {} as T;
    }
}

export function resolvePath(p: string): string {
    return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

export function loadConfig(): any {
    return readYamlFile(path.join(ROOT, "config", "default.yaml"));
}

export function loadPrompt(name: string): any {
    return readYamlFile(path.join(ROOT, "prompts", `${name}.yaml`));
}

export function getSpeakers(): Record<string, number> {
    const cfg = loadConfig();
    return cfg.providers.tts.voicevox.speakers;
}

export function getLlmModel(): string {
    const cfg = loadConfig();
    return cfg.providers.llm.gemini.model;
}

export function createLlm(options: any = {}): ChatGoogleGenerativeAI {
    return new ChatGoogleGenerativeAI({
        model: options.model || getLlmModel(),
        apiKey: process.env.GEMINI_API_KEY,
        temperature: options.temperature,
        ...options.extra
    });
}

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

export abstract class BaseAgent {
    store: AssetStore;
    name: string;
    opts: any;

    constructor(store: AssetStore, name: string, opts: any = {}) {
        this.store = store;
        this.name = name;
        this.opts = opts;
    }

    async runLlm<T>(system: string, user: string, parser: (text: string) => T, callOpts: any = {}): Promise<T> {
        if (process.env.SKIP_LLM === "true") return this.store.load(this.name, "output") as T;
        const llm = createLlm({ ...this.opts, ...callOpts });
        const res = await llm.invoke([{ role: "system", content: system }, { role: "user", content: user }]);
        const parsed = parser(res.content as string);
        this.store.save(this.name, "raw_response", { content: res.content });
        this.store.logOutput(this.name, parsed);
        return parsed;
    }

    loadPrompt(name: string) { return loadPrompt(name); }
    logInput(data: any) { this.store.logInput(this.name, data); }
}
