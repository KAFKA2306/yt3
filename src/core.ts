import path from "path";
import fs from "fs-extra";
import yaml from "js-yaml";
import dotenv from "dotenv";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AgentState, AppConfig, PromptData } from "./types.js";
import { AgentLogger } from "./utils/logger.js";

export const ROOT = process.cwd();
dotenv.config({ path: path.join(ROOT, "config", ".env") });
AgentLogger.init();

export enum RunStage {
    RESEARCH = "research",
    CONTENT = "content",
    MEDIA = "media",
    MEMORY = "memory",
    PUBLISH = "publish",
    WATCHER = "watcher"
}

export function readYamlFile<T>(filePath: string): T {
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
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

export function wrapText(text: string, max: number): string {
    return text.match(new RegExp(`.{1,${max}}`, 'g'))?.join('\n') || text;
}

export function fitText(text: string, baseSize: number, maxW: number, minFz: number = 40): { formattedText: string, fontSize: number } {
    const safeChars = Math.floor(maxW / baseSize);
    const tooLong = text.length > safeChars * 2;
    const size = tooLong ? minFz : baseSize;
    const finalSafe = tooLong ? Math.floor(maxW / size) : safeChars;
    return { formattedText: wrapText(text, finalSafe), fontSize: size };
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
    cfg: AppConfig;
    constructor(runId: string) {
        const c = loadConfig();
        this.cfg = c;
        this.runDir = path.join(ROOT, c.workflow.paths.runs_dir, runId);
        fs.ensureDirSync(this.runDir);
    }
    loadState(): Partial<AgentState> {
        let state: Partial<AgentState> = {};
        const stateJson = path.join(this.runDir, this.cfg.workflow.filenames.state);
        if (fs.existsSync(stateJson)) state = JSON.parse(fs.readFileSync(stateJson, "utf-8"));
        for (const step of [RunStage.RESEARCH, RunStage.CONTENT, RunStage.MEDIA, RunStage.MEMORY]) {
            const outputPath = path.join(this.runDir, step, this.cfg.workflow.filenames.output);
            if (fs.existsSync(outputPath)) Object.assign(state, yaml.load(fs.readFileSync(outputPath, "utf-8")));
        }
        return state;
    }
    updateState(update: Partial<AgentState>): void {
        const state = this.loadState();
        const newState = { ...state, ...update };
        fs.writeFileSync(path.join(this.runDir, this.cfg.workflow.filenames.state), JSON.stringify(newState, null, 2));
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
        return readYamlFile<T>(p);
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
        this.save(stage, this.cfg.workflow.filenames.output.replace(".yaml", ""), data);
    }
    audioDir(): string {
        const d = path.join(this.runDir, this.cfg.workflow.filenames.audio_dir || "audio");
        fs.ensureDirSync(d);
        return d;
    }
    videoDir(): string {
        const d = path.join(this.runDir, this.cfg.workflow.filenames.video_dir || "video");
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
    get config(): AppConfig {
        return this.store.cfg;
    }
    async runLlm<T>(system: string, user: string, parser: (text: string) => T, callOpts: Record<string, unknown> = {}): Promise<T> {
        AgentLogger.info(this.name, "RUN", "START_LLM", `Invoking LLM for ${this.name}`);
        if (process.env.SKIP_LLM === "true") {
            AgentLogger.info(this.name, "RUN", "SKIP_LLM", "Reading output from cache due to SKIP_LLM=true");
            return this.store.load<T>(this.name, "output");
        }
        const llm = createLlm({ ...this.opts, ...callOpts });
        const res = await llm.invoke([{ role: "system", content: system }, { role: "user", content: user }]);
        this.store.save(this.name, "raw_response", { content: res.content });
        const parsed = parser(res.content as string);
        AgentLogger.decision(this.name, "RUN", "LLM_SUCCESS", `Successfully parsed response for ${this.name}`, {
            model: getLlmModel()
        });
        return parsed;
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

export async function loadMemoryContext(agent: BaseAgent, query: string): Promise<{ recent: string; essences: string }> {
    const cfg = loadConfig();
    const researchCfg = cfg.steps.research;
    if (!researchCfg) throw new Error("Research config missing");
    const memDir = cfg.workflow.paths.memory_dir;
    const idxPath = path.join(ROOT, memDir, "index.json");
    const essPath = path.join(ROOT, memDir, "essences.json");
    const idx = fs.existsSync(idxPath) ? fs.readJsonSync(idxPath) : { videos: [] };
    const ess = fs.existsSync(essPath) ? fs.readJsonSync(essPath) : { essences: [] };
    const recent = idx.videos.filter((v: { topic: string; date: string }) => (Date.now() - new Date(v.date).getTime()) / 86400000 <= researchCfg.recent_days);
    let relevant = ess.essences;
    if (ess.essences.length > 5) {
        const candidates = ess.essences.map((e: { topic: string }) => e.topic).join("\n");
        const selected = await agent.runLlm("Select topics relevant to query. Return JSON array of strings.", `Query: ${query}\nCandidates:\n${candidates}`, t => parseLlmJson<string[]>(t), { temperature: cfg.providers.llm.research?.relevance_temperature || 0 });
        if (Array.isArray(selected) && selected.length) {
            relevant = ess.essences.filter((e: { topic: string }) => selected.includes(e.topic));
        }
    }
    return {
        recent: recent.map((v: { topic: string }) => `- ${v.topic}`).join("\n"),
        essences: relevant.slice(0, researchCfg.essence_limit).map((e: { topic: string; key_insights: string[] }) => `【${e.topic}】\n${e.key_insights.join("\n")}`).join("\n")
    };
}
