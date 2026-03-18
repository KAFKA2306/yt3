import path from "node:path";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import * as dotenv from "dotenv";
import fs from "fs-extra";
import yaml from "js-yaml";
import type { z } from "zod";
import { ContextPlaybook } from "../domain/ace/context_playbook.js";
import { type AgentState, type AppConfig, RunStage } from "../domain/types.js";
import { ROOT, loadConfig as baseLoadConfig } from "./base.js";
import { AgentLogger as Logger } from "./utils/logger.js";
import { QuotaManager } from "./utils/quota_manager.js";

dotenv.config({ path: path.join(ROOT, "config/.env"), override: true });

export { Logger as AgentLogger };
export type { AgentState };
export { RunStage };

export function loadConfig(): AppConfig {
	return baseLoadConfig() as AppConfig;
}
export { ROOT };
export interface LlmOptions {
	model?: string;
	temperature?: number;
	response_mime_type?: string;
	provider?: "gemini" | "local";
	sessionId?: string;
	extra?: Record<string, unknown>;
}
export function createLlm(
	options: LlmOptions = {},
): BaseChatModel & { keyName?: string } {
	const { extra = {}, ...rest } = options;
	const cfg = loadConfig();

	const { name: keyName, key: apiKey } = QuotaManager.acquireKey(
		options.sessionId,
	);

	Logger.info(
		"SYSTEM",
		"CORE",
		"API_CHECK",
		`Using key ${keyName} starting with: ${apiKey.slice(0, 8)}...`,
	);

	const llm = new ChatGoogleGenerativeAI({
		model: options.model ?? cfg.providers.llm.gemini.model,
		apiKey,
		temperature: options.temperature,
		maxOutputTokens: cfg.providers.llm.gemini.max_tokens,
		...extra,
		...rest,
	} as ConstructorParameters<
		typeof ChatGoogleGenerativeAI
	>[0]) as BaseChatModel & { keyName?: string };

	llm.keyName = keyName;
	return llm;
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
		const prompts = this.config.prompts as Record<string, unknown>;
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

		if (process.env.SKIP_LLM === "true") {
			const prev = this.store.load<unknown>(this.name, "output");
			if (prev) return prev as T;
			throw new Error("No previous data for LLM bypass");
		}

		const llm = createLlm({
			...this.opts,
			sessionId: this.store.runDir,
		});
		const keyName = llm.keyName || "unknown";
		const quotaContext = QuotaManager.getQuotaContext(keyName, "gemini");
		const finalSystemPrompt = `${systemPrompt}\n\n${aceContext}\n\n${quotaContext}`;

		Logger.info(
			"SYSTEM",
			"CORE",
			"LLM_INVOKE",
			`Invoking LLM with prompt: ${userPrompt.slice(0, 500)}...`,
		);
		const res = await llm.invoke(
			[
				{ role: "system", content: finalSystemPrompt },
				{ role: "user", content: userPrompt },
			],
			callOpts as Record<string, unknown>,
		);

		const metadata = res.response_metadata as Record<string, unknown>;
		if (keyName && metadata?.headers) {
			QuotaManager.updateFromHeaders(
				keyName,
				metadata.headers as Record<string, unknown>,
			);
		}

		return parser(res.content as string);
	}
}
function cleanCodeBlock(text: string): string {
	const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
	const match = stripped.match(/([{[][\s\S]*[}\]])/);
	return match ? (match[1] || match[0]).trim() : stripped;
}

function repairJson(text: string): string {
	let cleaned = cleanCodeBlock(text);

	let inString = false;
	let escaped = false;
	for (let i = 0; i < cleaned.length; i++) {
		const char = cleaned[i];
		if (char === '"' && !escaped) inString = !inString;
		escaped = char === "\\" && !escaped;
	}
	if (inString) cleaned += '"';

	const stack: string[] = [];
	inString = false;
	escaped = false;
	for (let i = 0; i < cleaned.length; i++) {
		const char = cleaned[i];
		if (char === '"' && !escaped) {
			inString = !inString;
			continue;
		}
		if (inString) {
			escaped = char === "\\" && !escaped;
			continue;
		}

		if (char === "{") stack.push("}");
		else if (char === "[") stack.push("]");
		else if (char === "}" || char === "]") {
			if (stack.length > 0 && stack[stack.length - 1] === char) {
				stack.pop();
			}
		}
	}

	while (stack.length > 0) {
		cleaned += stack.pop();
	}

	cleaned = cleaned.replace(/,\s*}/g, "}").replace(/,\s*\]/g, "]");

	return cleaned;
}

export function parseLlmJson<T>(text: string, schema?: z.ZodSchema<T>): T {
	const repaired = repairJson(text);
	const json = JSON.parse(repaired);
	return schema ? schema.parse(json) : (json as T);
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
	maxWidth: number,
	_minFontSize: number,
): { formattedText: string; fontSize: number } {
	const charWidth = baseFontSize * 0.9;
	const maxChars = Math.floor(maxWidth / charWidth);

	if (text.length <= maxChars) {
		return { formattedText: text, fontSize: baseFontSize };
	}

	const lines = [];
	for (let i = 0; i < text.length; i += maxChars) {
		lines.push(text.slice(i, i + maxChars));
	}

	return { formattedText: lines.join("\n"), fontSize: baseFontSize };
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
	return "";
}

export function fetchRecentThemes(store: AssetStore, days = 7): string {
	const cfg = loadConfig();
	const runsDir = path.join(ROOT, cfg.workflow.paths.runs_dir);

	if (!fs.existsSync(runsDir)) {
		Logger.warn("SYSTEM", "CORE", "FETCH_THEMES", "Runs directory not found");
		return "";
	}

	const runDirs = fs
		.readdirSync(runsDir)
		.filter((name) => /^\d{4}-\d{2}-\d{2}/.test(name))
		.sort()
		.reverse()
		.slice(0, days);

	const themes: Array<{ date: string; categories: string[] }> = [];

	for (const dir of runDirs) {
		const outputPath = path.join(runsDir, dir, "research", "output.yaml");
		if (fs.existsSync(outputPath)) {
			const content = fs.readFileSync(outputPath, "utf-8");
			const output = yaml.load(content) as Record<string, unknown>;

			if (Array.isArray(output.selected_topics)) {
				const categories = output.selected_topics
					.map((topic: Record<string, unknown>) => topic.category)
					.filter(Boolean) as string[];

				if (categories.length > 0) {
					themes.push({ date: dir, categories });
				}
			} else if (output.selected_topic && output.angle) {
				const angle = String(output.angle).toLowerCase();
				const category = inferCategoryFromAngle(angle);
				themes.push({ date: dir, categories: [category] });
			}
		}
	}

	if (themes.length === 0) {
		return "(Recent theme history not available)";
	}

	return themes
		.map(({ date, categories }) => `${date}: ${categories.join(", ")}`)
		.join("\n");
}

function inferCategoryFromAngle(angle: string): string {
	const lowerAngle = angle.toLowerCase();
	if (
		lowerAngle.includes("金利") ||
		lowerAngle.includes("インフレ") ||
		lowerAngle.includes("cpi") ||
		lowerAngle.includes("gdp") ||
		lowerAngle.includes("frb")
	) {
		return "マクロ経済";
	}
	if (
		lowerAngle.includes("決算") ||
		lowerAngle.includes("投資") ||
		lowerAngle.includes("m&a") ||
		lowerAngle.includes("配当") ||
		lowerAngle.includes("earnings")
	) {
		return "企業財務";
	}
	if (
		lowerAngle.includes("地政学") ||
		lowerAngle.includes("戦争") ||
		lowerAngle.includes("制裁") ||
		lowerAngle.includes("国際") ||
		lowerAngle.includes("geopolitics")
	) {
		return "地政学";
	}
	if (
		lowerAngle.includes("技術") ||
		lowerAngle.includes("ai") ||
		lowerAngle.includes("半導体") ||
		lowerAngle.includes("新製品") ||
		lowerAngle.includes("technology")
	) {
		return "テクノロジー";
	}
	if (
		lowerAngle.includes("投資家") ||
		lowerAngle.includes("変動性") ||
		lowerAngle.includes("トレンド") ||
		lowerAngle.includes("心理") ||
		lowerAngle.includes("sentiment")
	) {
		return "市場心理";
	}
	return "その他";
}
