
import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), "config", ".env") });

export const ROOT = process.cwd();

function loadYaml(filePath: string): any {
    const file = fs.readFileSync(filePath, "utf8");
    return yaml.load(file);
}

export function loadConfig(): any {
    return loadYaml(path.join(ROOT, "config", "default.yaml"));
}

export function loadPrompt(name: string): any {
    return loadYaml(path.join(ROOT, "prompts", `${name}.yaml`));
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
