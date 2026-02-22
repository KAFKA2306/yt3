import path from "node:path";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import fs from "fs-extra";
import yaml from "js-yaml";
import type { z } from "zod";
import { ROOT, loadConfig as baseLoadConfig } from "./base.js";
import { type AgentState, type AppConfig, RunStage } from "./types.js";
import { AgentLogger as Logger } from "./utils/logger.js";

export { Logger as AgentLogger };
export { RunStage };
export const loadConfig = baseLoadConfig;
export { ROOT };

export function readYamlFile<T>(p: string): T {
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  return yaml.load(fs.readFileSync(p, "utf-8")) as T;
}

export function getSpeakers(): Record<string, number> {
  const p = path.join(ROOT, "config", "speakers.yaml");
  return readYamlFile<Record<string, number>>(p);
}

export function getLlmModel(): string {
  const cfg = loadConfig();
  return cfg.providers.llm.gemini.model || "gemini-1.5-flash";
}

export interface LlmOptions {
  model?: string;
  temperature?: number;
  extra?: Record<string, unknown>;
}

export function createLlm(options: LlmOptions = {}): ChatGoogleGenerativeAI {
  const { extra = {}, ...rest } = options;
  const config = {
    model: options.model || getLlmModel(),
    apiKey: process.env["GEMINI_API_KEY"],
    temperature: options.temperature,
    ...extra,
    ...rest,
  };
  return new ChatGoogleGenerativeAI(config as { model: string } & Record<string, unknown>);
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
    if (fs.existsSync(stateJson)) state = fs.readJsonSync(stateJson);
    const stages = [RunStage.RESEARCH, RunStage.CONTENT, RunStage.MEDIA, RunStage.MEMORY];
    for (const step of stages) {
      const outputPath = path.join(this.runDir, step, this.cfg.workflow.filenames.output);
      if (fs.existsSync(outputPath))
        Object.assign(state, yaml.load(fs.readFileSync(outputPath, "utf-8")));
    }
    return state;
  }
  updateState(patches: Partial<AgentState>) {
    const stateJson = path.join(this.runDir, this.cfg.workflow.filenames.state);
    const current = this.loadState();
    const next = { ...current, ...patches };
    fs.writeJsonSync(stateJson, next, { spaces: 2 });
  }
  load<T>(stage: string, type: "input" | "output" | "prompt"): T | null {
    const f =
      type === "input"
        ? (this.cfg.workflow.filenames as Record<string, string | undefined>)["input"] ||
          "input.yaml"
        : type === "output"
          ? this.cfg.workflow.filenames.output
          : `${stage}_prompt.yaml`;
    const p = path.join(this.runDir, stage, f);
    if (!fs.existsSync(p)) return null;
    return (p.endsWith(".json") ? fs.readJsonSync(p) : yaml.load(fs.readFileSync(p, "utf-8"))) as T;
  }
  save(stage: string, type: "input" | "output", data: unknown) {
    const f =
      type === "input"
        ? (this.cfg.workflow.filenames as Record<string, string | undefined>)["input"] ||
          "input.yaml"
        : this.cfg.workflow.filenames.output;
    const p = path.join(this.runDir, stage, f);
    fs.ensureDirSync(path.dirname(p));
    if (f.endsWith(".json")) fs.writeJsonSync(p, data, { spaces: 2 });
    else fs.writeFileSync(p, yaml.dump(data));
  }
  audioDir(): string {
    const p = path.join(this.runDir, "media", "audio");
    fs.ensureDirSync(p);
    return p;
  }
  videoDir(): string {
    const p = path.join(this.runDir, "media", "video");
    fs.ensureDirSync(p);
    return p;
  }
}

export abstract class BaseAgent {
  store: AssetStore;
  name: string;
  config: AppConfig;
  opts: Record<string, unknown>;
  constructor(store: AssetStore, name: string, opts: Record<string, unknown> = {}) {
    this.store = store;
    this.name = name;
    this.config = store.cfg;
    this.opts = opts;
  }
  logInput(data: unknown) {
    this.store.save(this.name, "input", data);
  }
  logOutput(data: unknown) {
    this.store.save(this.name, "output", data);
  }
  loadPrompt<T>(name: string): T {
    const p = path.join(ROOT, "prompts", `${name}.yaml`);
    return yaml.load(fs.readFileSync(p, "utf-8")) as T;
  }
  async runLlm<T>(
    systemPrompt: string,
    userPrompt: string,
    parser: (text: string) => T,
    callOpts: Record<string, unknown> = {},
  ): Promise<T> {
    Logger.info(this.name, "RUN", "START_LLM", `Invoking LLM for ${this.name}`);
    if (process.env["SKIP_LLM"] === "true") {
      Logger.info(this.name, "RUN", "LLM_SKIP", "LLM bypass enabled. Loading mock/previous data.");
      const prev = this.store.load<unknown>(this.name, "output");
      if (prev) return prev as T;
      throw new Error("No previous data for LLM bypass");
    }
    const llm = createLlm(this.opts);
    const res = await llm.invoke(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      callOpts as Record<string, unknown>,
    );
    return parser(res.content as string);
  }
}

export function parseLlmJson<T>(text: string, schema: z.ZodSchema<T>): T {
  const match = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/({[\s\S]*})/);
  if (!match) throw new Error("No JSON found in LLM response");
  const json = JSON.parse(match[1] || "{}");
  return schema.parse(json);
}

export async function runMcpTool(
  serverName: string,
  _config: unknown,
  toolName: string,
  _args: unknown,
) {
  Logger.info("McpClient", "CALL", serverName, `Calling tool ${toolName}`);
  return { data: {} };
}

export function fitText(
  text: string,
  baseFontSize: number,
  _maxWidth: number,
  _minFontSize: number,
): { formattedText: string; fontSize: number } {
  return { formattedText: text, fontSize: baseFontSize };
}

export function resolvePath(p: string): string {
  return path.resolve(ROOT, p);
}

export function getCurrentDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function loadMemoryContext(store: AssetStore): string {
  const p = path.join(store.runDir, "..", "memory.txt");
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
  return "";
}
