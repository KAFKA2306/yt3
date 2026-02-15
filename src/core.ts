
import path from "path";
import fs from "fs-extra";
import yaml from "js-yaml";
import dotenv from "dotenv";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState, AppConfig, PromptData } from "./types.js";
import { AgentLogger } from "./utils/logger.js";

dotenv.config({ path: path.join(process.cwd(), "config", ".env") });
AgentLogger.init();

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
    return (yaml.load(cleanCodeBlock(text)) || {}) as T;
}

export function parseCriticScore(text: string | unknown): { score: number; critique: string } {
    const json = parseLlmJson<{ score: number; critique: string }>(text);
    return {
        score: typeof json.score === 'number' ? json.score : 0,
        critique: json.critique || ""
    };
}

export function resolvePath(p: string): string {
    return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

export function loadConfig(): AppConfig & { regions: string[] } {
    const cfg = readYamlFile<AppConfig & { workflow: { trend_settings: { regions: string[] } } }>(path.join(ROOT, "config", "default.yaml"));
    if (process.env.DRY_RUN === "true") {
        if (cfg.steps.youtube) cfg.steps.youtube.dry_run = true;
        if (cfg.steps.twitter) cfg.steps.twitter.dry_run = true;
    }
    return { ...cfg, regions: cfg.workflow.trend_settings.regions };
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

export class BaseAgent {
    store: AssetStore;
    name: string;
    opts: Record<string, unknown>;

    constructor(store: AssetStore, name: string, opts: Record<string, unknown> = {}) {
        this.store = store;
        this.name = name;
        this.opts = opts;
    }

    async runLlm<T>(system: string, user: string, parser: (text: string) => T, callOpts: Record<string, unknown> = {}): Promise<T> {
        AgentLogger.info(this.name, "RUN", "START_LLM", `Invoking LLM for ${this.name}`);
        if (process.env.SKIP_LLM === "true") {
            AgentLogger.info(this.name, "RUN", "SKIP_LLM", "Reading output from cache due to SKIP_LLM=true");
            return this.store.load<T>(this.name, "output");
        }

        try {
            const llm = createLlm({ ...this.opts, ...callOpts });
            const res = await llm.invoke([{ role: "system", content: system }, { role: "user", content: user }]);

            this.store.save(this.name, "raw_response", { content: res.content });
            const parsed = parser(res.content as string);
            this.store.logOutput(this.name, parsed);

            AgentLogger.decision(this.name, "RUN", "LLM_SUCCESS", `Successfully parsed response for ${this.name}`, {
                model: getLlmModel()
            });

            return parsed;
        } catch (error) {
            AgentLogger.error(this.name, "RUN", "LLM_FAILURE", `Failed LLM call for ${this.name}`, error as Error, {
                recovery_hint: "Check API availability or rate limits. The Manager Agent will attempt retry."
            });
            throw error;
        }
    }

    loadPrompt<T = PromptData>(name: string): T { return loadPrompt(name) as T; }

    logInput(data: unknown) {
        this.store.logInput(this.name, data);
        AgentLogger.info(this.name, "IO", "LOG_INPUT", "Stored agent input data");
    }

    logOutput(data: unknown) {
        this.store.logOutput(this.name, data);
        AgentLogger.info(this.name, "IO", "LOG_OUTPUT", "Stored agent output data");
    }
}
