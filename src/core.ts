
import path from "path";
import fs from "fs-extra";
import yaml from "js-yaml";
import dotenv from "dotenv";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState, AppConfig, PromptData } from "./types.js";

dotenv.config({ path: path.join(process.cwd(), "config", ".env") });

export const ROOT = process.cwd();

export function readYamlFile<T>(filePath: string): T {
    return yaml.load(fs.readFileSync(filePath, "utf8")) as T;
}

export function cleanCodeBlock(text: string | unknown): string {
    const s = typeof text === "string" ? text : JSON.stringify(text);
    const match = s.match(/```(?:json|yaml|)\s*([\s\S]*?)\s*```/i);
    return (match ? match[1] : s).trim();
}

export function parseLlmJson<T>(text: string | unknown): T {
    return JSON.parse(cleanCodeBlock(text)) as T;
}

export function parseLlmYaml<T>(text: string | unknown): T {
    return yaml.load(cleanCodeBlock(text)) as T;
}

export function resolvePath(p: string): string {
    return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

export function loadConfig(): AppConfig {
    const cfg = readYamlFile<AppConfig>(path.join(ROOT, "config", "default.yaml"));
    if (process.env.DRY_RUN === "true") {
        if (cfg.steps.youtube) cfg.steps.youtube.dry_run = true;
        if (cfg.steps.twitter) cfg.steps.twitter.dry_run = true;
    }
    return cfg;
}

export function loadPrompt(name: string): PromptData {
    return readYamlFile<PromptData>(path.join(ROOT, "prompts", `${name}.yaml`));
}

export function getSpeakers(): Record<string, number> {
    const cfg = loadConfig();
    return cfg.providers.tts.voicevox.speakers;
}

export function getLlmModel(): string {
    const cfg = loadConfig();
    return cfg.providers.llm.gemini.model;
}

export function createLlm(options: { model?: string; temperature?: number; extra?: Record<string, unknown> } = {}): ChatGoogleGenerativeAI {
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

    loadState(): Partial<AgentState> {
        let state: Partial<AgentState> = {};
        const stateJson = path.join(this.runDir, "state.json");
        if (fs.existsSync(stateJson)) state = JSON.parse(fs.readFileSync(stateJson, "utf-8"));
        for (const step of ["research", "content", "media", "memory"]) {
            const outputPath = path.join(this.runDir, step, "output.yaml");
            if (fs.existsSync(outputPath)) Object.assign(state, yaml.load(fs.readFileSync(outputPath, "utf-8")));
        }
        return state;
    }

    updateState(update: Partial<AgentState>): void {
        const state = this.loadState();
        const newState = { ...state, ...update };
        fs.writeFileSync(path.join(this.runDir, "state.json"), JSON.stringify(newState, null, 2));
    }

    save(stage: string, name: string, data: unknown): string {
        const stageDir = path.join(this.runDir, stage);
        fs.ensureDirSync(stageDir);
        const p = path.join(stageDir, `${name}.yaml`);
        fs.writeFileSync(p, yaml.dump(data));
        return p;
    }

    load<T>(stage: string, name: string): T {
        const p = path.join(this.runDir, stage, `${name}.yaml`);
        return yaml.load(fs.readFileSync(p, "utf8")) as T;
    }

    saveBinary(stage: string, name: string, data: Buffer): string {
        const stageDir = path.join(this.runDir, stage);
        fs.ensureDirSync(stageDir);
        const p = path.join(stageDir, name);
        fs.writeFileSync(p, data);
        return p;
    }

    logInput(stage: string, data: unknown): void {
        this.save(stage, "input", data);
    }

    logOutput(stage: string, data: unknown): void {
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
    opts: Record<string, unknown>;

    constructor(store: AssetStore, name: string, opts: Record<string, unknown> = {}) {
        this.store = store;
        this.name = name;
        this.opts = opts;
    }

    async runLlm<T>(system: string, user: string, parser: (text: string) => T, callOpts: Record<string, unknown> = {}): Promise<T> {
        if (process.env.SKIP_LLM === "true") return this.store.load<T>(this.name, "output");
        const llm = createLlm({ ...this.opts, ...callOpts });
        const res = await llm.invoke([{ role: "system", content: system }, { role: "user", content: user }]);
        this.store.save(this.name, "raw_response", { content: res.content });
        try {
            const parsed = parser(res.content as string);
            this.store.logOutput(this.name, parsed);
            return parsed;
        } catch (e) {
            console.error(`Failed to parse LLM response for ${this.name}:`, res.content);
            throw e;
        }
    }

    loadPrompt(name: string) { return loadPrompt(name); }
    logInput(data: unknown) { this.store.logInput(this.name, data); }
}
