import path from "node:path";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import fs from "fs-extra";
import yaml from "js-yaml";
import type { z } from "zod";
import { ContextPlaybook } from "./ace/context_playbook.js";
import { ROOT, loadConfig as baseLoadConfig } from "./base.js";
import { type AgentState, type AppConfig, RunStage } from "./types.js";
import { AgentLogger as Logger } from "./utils/logger.js";
export { Logger as AgentLogger };
export { RunStage };
export const MANDATORY_MODEL = "gemini-3-flash-preview" as const;

export function loadConfig(): AppConfig {
	const cfg = baseLoadConfig() as AppConfig;
	// Fundamental Enforcement: Override any config-level model setting at runtime
	if (cfg.providers?.llm?.gemini) {
		cfg.providers.llm.gemini.model = MANDATORY_MODEL;
	}
	return cfg;
}
export { ROOT };
export interface LlmOptions {
	model?: string;
	temperature?: number;
	response_mime_type?: string;
	extra?: Record<string, unknown>;
}
export function createLlm(options: LlmOptions = {}): ChatGoogleGenerativeAI {
	const MANDATORY_MODEL = "gemini-3-flash-preview";
	const { extra = {}, ...rest } = options;
	const cfg = loadConfig();

	const requestedModel = options.model || cfg.providers.llm.gemini.model;
	if (requestedModel && requestedModel !== MANDATORY_MODEL) {
		Logger.warn("SYSTEM", "CORE", "MODEL_POLICY_OVERRIDE",
			`Requested model ${requestedModel} ignored per strict policy. Using ${MANDATORY_MODEL}.`
		);
	}

	return new ChatGoogleGenerativeAI({
		model: MANDATORY_MODEL,
		apiKey: process.env.GEMINI_API_KEY,
		temperature: options.temperature,
		...extra,
		...rest,
	} as { model: string } & Record<string, unknown>);
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
		const stages = [
			RunStage.RESEARCH,
			RunStage.CONTENT,
			RunStage.MEDIA,
			RunStage.MEMORY,
		];
		for (const step of stages) {
			const outputPath = path.join(
				this.runDir,
				step,
				this.cfg.workflow.filenames.output,
			);
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
				? (this.cfg.workflow.filenames as Record<string, string | undefined>)
					.input || "input.yaml"
				: type === "output"
					? this.cfg.workflow.filenames.output
					: `${stage}_prompt.yaml`;
		const p = path.join(this.runDir, stage, f);
		if (!fs.existsSync(p)) return null;
		return (
			p.endsWith(".json")
				? fs.readJsonSync(p)
				: yaml.load(fs.readFileSync(p, "utf-8"))
		) as T;
	}
	save(stage: string, type: "input" | "output", data: unknown) {
		const f =
			type === "input"
				? (this.cfg.workflow.filenames as Record<string, string | undefined>)
					.input || "input.yaml"
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
	constructor(
		store: AssetStore,
		name: string,
		opts: Record<string, unknown> = {},
	) {
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
		const prompts = this.config.prompts;
		if (!prompts || !prompts[name])
			throw new Error(`Prompt not found: ${name}`);
		return prompts[name] as T;
	}
	async runLlm<T>(
		systemPrompt: string,
		userPrompt: string,
		parser: (text: string) => T,
		callOpts: Record<string, unknown> = {},
	): Promise<T> {
		const playbook = new ContextPlaybook();
		const bullets = playbook.getRankedBullets(5);
		const aceContext =
			bullets.length > 0
				? `\n\n[ACE Intelligence - Strategic Instructions]\n${bullets.map((b) => `- ${b.content} (ID: ${b.id})`).join("\n")}`
				: "";
		const finalSystemPrompt = systemPrompt + aceContext;
		if (process.env.SKIP_LLM === "true") {
			const prev = this.store.load<unknown>(this.name, "output");
			if (prev) return prev as T;
			throw new Error("No previous data for LLM bypass");
		}
		const llm = createLlm(this.opts);
		const res = await llm.invoke(
			[
				{ role: "system", content: finalSystemPrompt },
				{ role: "user", content: userPrompt },
			],
			callOpts as Record<string, unknown>,
		);
		return parser(res.content as string);
	}
}
export function cleanCodeBlock(text: string): string {
	const match =
		text.match(/```(?:json)?\n([\s\S]*?)\n```/) ||
		text.match(/([{\[][\s\S]*[}\]])/);
	return match ? (match[1] || match[0]).trim() : text.trim();
}
export function parseLlmJson<T>(text: string, schema?: z.ZodSchema<T>): T {
	const cleaned = cleanCodeBlock(text);
	try {
		const json = JSON.parse(cleaned);
		return schema ? schema.parse(json) : (json as T);
	} catch (e) {
		Logger.error("SYSTEM", "JSON", "PARSE_ERROR", (e as Error).message, e as Error, {
			context: {
				raw_text: text.slice(0, 1000) + (text.length > 1000 ? "..." : ""),
				cleaned_text: cleaned.slice(0, 1000) + (cleaned.length > 1000 ? "..." : ""),
			},
		});
		throw e;
	}
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
export function getRunIdDateString(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}
export function loadMemoryContext(store: AssetStore): string {
	const cfg = store.cfg.workflow.memory;
	const memPath = path.isAbsolute(cfg.index_file)
		? cfg.index_file
		: path.join(ROOT, cfg.index_file);
	const dir = path.dirname(memPath);
	const idxPath = path.join(dir, "index.json");

	if (fs.existsSync(idxPath)) {
		try {
			const index = fs.readJsonSync(idxPath);
			if (index.videos && Array.isArray(index.videos)) {
				// Get last 10 topics to keep prompt slim
				return index.videos
					.slice(-20)
					.map((v: { topic: string }) => v.topic)
					.join(", ");
			}
		} catch (e) {
			Logger.warn("SYSTEM", "MEMORY", "LOAD_ERROR", "Failed to parse memory index");
		}
	}
	return "";
}
