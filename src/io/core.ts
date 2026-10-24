import path from "node:path";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import * as dotenv from "dotenv";
import fs from "fs-extra";
import yaml from "js-yaml";
import { z } from "zod";
import { type AgentState, type AppConfig, RunStage } from "../domain/types.js";
import { getYouTubeProfile } from "../domain/youtube_profiles.js";
export const ROOT = process.cwd();

export function loadConfig(
	domainId = process.env.BUCKET?.trim() || "byosan_money",
): AppConfig {
	const configPath = process.env.CONFIG_PATH;
	if (configPath && fs.existsSync(configPath)) {
		return yaml.load(fs.readFileSync(configPath, "utf-8")) as AppConfig;
	}

	const domainConfigPath = path.join(
		ROOT,
		"config",
		"domains",
		`${domainId}.yaml`,
	);
	if (fs.existsSync(domainConfigPath)) {
		return yaml.load(fs.readFileSync(domainConfigPath, "utf-8")) as AppConfig;
	}

	throw new Error(`CRITICAL: No configuration found for domain '${domainId}'`);
}

import { AgentLogger as Logger } from "./utils/logger.js";
import {
	QuotaExhaustionError,
	acquireKey,
	getQuotaContext,
	markKeyRateLimited,
	updateFromHeaders,
	waitIfRateLimited,
} from "./utils/quota/manager.js";
import {
	type FailureClassification,
	classifyFailureMessage,
} from "./utils/stability.js";

const selectedEnvFile =
	process.env.ENV_FILE ??
	(process.env.YOUTUBE_CHANNEL_PROFILE
		? getYouTubeProfile().envFile
		: "config/.env");
const envFilePath = path.isAbsolute(selectedEnvFile)
	? selectedEnvFile
	: path.join(ROOT, selectedEnvFile);
dotenv.config({ path: envFilePath, override: true });

export { Logger as AgentLogger };
export type { AgentState };
export { RunStage };
export { QuotaExhaustionError };
export interface LoopMemoryEntry {
	run_id: string;
	bucket: string;
	stage: string;
	kind: "failure" | "success";
	summary: string;
	signals: string[];
	fixes: string[];
	timestamp: string;
}
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

	let domainId: string | undefined;
	if (options.sessionId?.includes("/")) {
		const parts = options.sessionId.split(path.sep);
		const runsIdx = parts.lastIndexOf("runs");
		if (runsIdx !== -1 && parts[runsIdx + 1]) {
			domainId = parts[runsIdx + 1];
		}
	}
	const cfg = loadConfig(domainId);

	const { name: keyName, key: apiKey } = acquireKey(options.sessionId);

	Logger.info(
		"SYSTEM",
		"CORE",
		"API_CHECK",
		`Using key ${keyName} (Domain: ${domainId || "byosan_money"})`,
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

export function redactLlmEvidence(value: string): string {
	let redacted = value;
	for (const name of [
		"GEMINI_API_KEY",
		"GEMINI_API_KEY_2",
		"GEMINI_API_KEY_3",
		"GEMINI_API_KEY_4",
		"GEMINI_API_KEY_5",
	]) {
		const secret = process.env[name];
		if (secret && secret.length >= 4) {
			redacted = redacted.replaceAll(secret, "[REDACTED_KEY]");
		}
	}
	return redacted
		.replaceAll(/AIza[A-Za-z0-9_-]{16,}/g, "[REDACTED_KEY]")
		.replaceAll(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_KEY]");
}

export type StructuredInvocationFailureClass =
	| "PROVIDER_RATE_LIMIT"
	| "PROVIDER_INVALID_KEY"
	| "PROVIDER_NON_RETRYABLE"
	| "SEMANTIC_VALIDATION";

export type StructuredInvocationAttempt = {
	attempt: number;
	keyName: string;
	status: "PASS" | "FAIL";
	failureClass?: StructuredInvocationFailureClass;
	details?: string;
};

const PROVIDER_UNSUPPORTED_SIZE_KEYWORDS = new Set([
	"minLength",
	"maxLength",
	"minItems",
	"maxItems",
	"minimum",
	"maximum",
	"pattern",
]);

function stripSizeKeywords(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(stripSizeKeywords);
	if (node === null || typeof node !== "object") return node;
	return Object.fromEntries(
		Object.entries(node)
			.filter(([key]) => !PROVIDER_UNSUPPORTED_SIZE_KEYWORDS.has(key))
			.map(([key, child]) => [
				key,
				key === "properties" && child !== null && typeof child === "object"
					? Object.fromEntries(
							Object.entries(child).map(([name, schema]) => [
								name,
								stripSizeKeywords(schema),
							]),
						)
					: stripSizeKeywords(child),
			]),
	);
}

export function providerResponseJsonSchema(
	schema: z.ZodType,
): Record<string, unknown> {
	return stripSizeKeywords(toJsonSchema(schema)) as Record<string, unknown>;
}

type JsonSchemaNode = Record<string, unknown>;

const MAX_CONSTRAINT_DEPTH = 16;

/**
 * Lists the length and count limits of a Zod schema as prompt lines, derived
 * from the same schema object that validates the output (the provider schema
 * strips these keywords, so they are read from the unstripped JSON schema).
 */
export function zodSizeConstraintLines(schema: z.ZodType): string[] {
	const root = toJsonSchema(schema) as JsonSchemaNode;
	const defs = {
		...((root.$defs as Record<string, JsonSchemaNode> | undefined) ?? {}),
		...((root.definitions as Record<string, JsonSchemaNode> | undefined) ?? {}),
	};
	const lines: string[] = [];
	const range = (
		min: unknown,
		max: unknown,
		unit: string,
	): string | undefined => {
		if (typeof min === "number" && typeof max === "number")
			return `${min}〜${max}${unit}`;
		if (typeof max === "number") return `${max}${unit}以内`;
		if (typeof min === "number") return `${min}${unit}以上`;
		return undefined;
	};
	const record = (path: string, text: string | undefined): void => {
		if (text && path) lines.push(`${path}: ${text}`);
	};
	const visit = (
		node: JsonSchemaNode,
		nodePath: string,
		refStack: string[],
	): void => {
		if (refStack.length > MAX_CONSTRAINT_DEPTH) return;
		if (typeof node.$ref === "string") {
			const name = node.$ref.split("/").pop() ?? "";
			const target = defs[name];
			if (!target || refStack.includes(name)) return;
			visit(target, nodePath, [...refStack, name]);
			return;
		}
		if (typeof node.description === "string") {
			record(nodePath, node.description);
		}
		if (Array.isArray(node.enum)) {
			record(nodePath, `次のいずれか: ${node.enum.join("、")}`);
		}
		for (const option of [node.anyOf, node.oneOf]) {
			if (Array.isArray(option)) {
				for (const branch of option)
					visit(branch as JsonSchemaNode, nodePath, refStack);
			}
		}
		if (node.type === "string") {
			record(nodePath, range(node.minLength, node.maxLength, "文字"));
		}
		if (node.type === "number" || node.type === "integer") {
			record(nodePath, range(node.minimum, node.maximum, ""));
		}
		if (node.type === "array") {
			record(nodePath, range(node.minItems, node.maxItems, "件"));
			if (node.items && typeof node.items === "object")
				visit(node.items as JsonSchemaNode, `${nodePath}[]`, refStack);
		}
		const properties = node.properties as
			| Record<string, JsonSchemaNode>
			| undefined;
		if (properties) {
			for (const [key, child] of Object.entries(properties)) {
				visit(child, nodePath ? `${nodePath}.${key}` : key, refStack);
			}
		}
	};
	visit(root, "", []);
	return lines;
}

function issuePathLabel(path: PropertyKey[]): string {
	if (path.length === 0) return "(root)";
	return path
		.map((segment, index) =>
			typeof segment === "number"
				? `[${segment}]`
				: `${index === 0 ? "" : "."}${String(segment)}`,
		)
		.join("");
}

/**
 * Formats Zod issues as the exact violated paths and their limits, so that a
 * retry can correct those fields instead of re-reading a raw issue dump.
 */
export function formatZodIssuesForRetry(error: z.ZodError): string {
	return error.issues
		.map((issue) => {
			const where = issuePathLabel(issue.path);
			const detail = issue as unknown as {
				origin?: string;
				maximum?: unknown;
				minimum?: unknown;
			};
			const unit =
				detail.origin === "string"
					? "文字"
					: detail.origin === "array"
						? "件"
						: "";
			if (issue.code === "too_big" && typeof detail.maximum === "number") {
				return `- ${where}: ${detail.maximum}${unit}以内にしてください（現在の出力は超過）`;
			}
			if (issue.code === "too_small" && typeof detail.minimum === "number") {
				return `- ${where}: ${detail.minimum}${unit}以上にしてください（現在の出力は不足）`;
			}
			return `- ${where}: ${issue.message}`;
		})
		.join("\n");
}

function llmContentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part: unknown) =>
				typeof part === "string"
					? part
					: part &&
							typeof part === "object" &&
							"text" in part &&
							typeof (part as { text: unknown }).text === "string"
						? (part as { text: string }).text
						: "",
			)
			.join("");
	}
	throw new Error(
		`LLM response content is invalid: type=${typeof content}, value=${JSON.stringify(content)?.slice(0, 100)}`,
	);
}

type StructuredResponse = { text: string; value: unknown };

/**
 * provider_schema: the provider enforces the JSON schema derived from the Zod
 * contract (feature draft and other provider-enforced outputs).
 * json_text: the model returns free text, parsed with the same Zod contract.
 * Use json_text when an untyped nested node would let the provider drop or
 * stringify fields (see research: byosan_angle).
 */
export type StructuredResponseFormat = "provider_schema" | "json_text";

export async function invokeStructuredLlm<T, U = T>(params: {
	schema: z.ZodSchema<T>;
	name: string;
	llmOptions?: LlmOptions;
	responseFormat?: StructuredResponseFormat;
	messages: (
		attempt: number,
		lastValidationError?: string,
	) => Array<{ role: "system" | "user"; content: string }>;
	validate?: (value: T) => U;
	maxAttempts?: number;
	evidencePath?: string;
	rawResponseDir?: string;
	llmFactory?: typeof createLlm;
	sleep?: (ms: number) => Promise<void>;
}): Promise<U> {
	const maxAttempts = params.maxAttempts ?? 3;
	const attempts: StructuredInvocationAttempt[] = [];
	const factory = params.llmFactory ?? createLlm;
	const responseFormat = params.responseFormat ?? "provider_schema";
	const responseSchema = providerResponseJsonSchema(params.schema);
	const sleep =
		params.sleep ??
		((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	let lastValidationError: string | undefined;
	let lastFailureWasQuota = false;

	const invokeProvider = async (
		llm: BaseChatModel & { keyName?: string },
		messages: Array<{ role: "system" | "user"; content: string }>,
	): Promise<StructuredResponse> => {
		if (responseFormat === "json_text") {
			const response = await llm.invoke(messages);
			return { text: llmContentText(response.content), value: undefined };
		}
		const value = await llm
			.withStructuredOutput(responseSchema, { name: params.name })
			.invoke(messages);
		return { text: JSON.stringify(value, null, 2) ?? "null", value };
	};

	const parseResponse = (response: StructuredResponse): T =>
		responseFormat === "json_text"
			? parseLlmJson(response.text, params.schema)
			: params.schema.parse(response.value);

	const persist = (): void => {
		if (!params.evidencePath) return;
		fs.ensureDirSync(path.dirname(params.evidencePath));
		fs.writeJsonSync(
			params.evidencePath,
			{
				schemaVersion: "structured_llm_attempts_v1",
				name: params.name,
				attempts,
			},
			{ spaces: 2 },
		);
	};

	const persistRawResponse = (
		attempt: number,
		keyName: string,
		text: string,
	): void => {
		if (!params.rawResponseDir) return;
		fs.outputJsonSync(
			path.join(params.rawResponseDir, `attempt-${attempt}.json`),
			{
				schemaVersion: "structured_llm_raw_response_v1",
				name: params.name,
				attempt,
				keyName,
				text: redactLlmEvidence(text),
			},
			{ spaces: 2 },
		);
	};

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const llm = factory(params.llmOptions ?? {});
		const keyName = llm.keyName ?? "unknown";
		await waitIfRateLimited(keyName);
		lastFailureWasQuota = false;

		let response: StructuredResponse;
		try {
			response = await invokeProvider(
				llm,
				params.messages(attempt, lastValidationError),
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const lower = message.toLowerCase();
			const rateLimited =
				message.includes("429") ||
				lower.includes("quota") ||
				lower.includes("rate limit");
			const invalidKey =
				lower.includes("api_key_invalid") ||
				lower.includes("api key not found") ||
				lower.includes("invalid api key");
			const semanticOutputError =
				error instanceof z.ZodError ||
				lower.includes("schema") ||
				lower.includes("failed to parse") ||
				lower.includes("output parser") ||
				lower.includes("structured output");
			if (semanticOutputError) {
				lastValidationError = message;
				attempts.push({
					attempt,
					keyName,
					status: "FAIL",
					failureClass: "SEMANTIC_VALIDATION",
					details: redactLlmEvidence(message).slice(0, 500),
				});
				persist();
				continue;
			}
			if (!rateLimited && !invalidKey) {
				attempts.push({
					attempt,
					keyName,
					status: "FAIL",
					failureClass: "PROVIDER_NON_RETRYABLE",
					details: redactLlmEvidence(message).slice(0, 500),
				});
				persist();
				throw error;
			}
			attempts.push({
				attempt,
				keyName,
				status: "FAIL",
				failureClass: invalidKey
					? "PROVIDER_INVALID_KEY"
					: "PROVIDER_RATE_LIMIT",
				details: redactLlmEvidence(message).slice(0, 500),
			});
			persist();
			lastFailureWasQuota = true;
			markKeyRateLimited(keyName);
			await sleep(invalidKey ? 2_000 : 10_000);
			continue;
		}

		persistRawResponse(attempt, keyName, response.text);
		let value: T;
		try {
			value = parseResponse(response);
		} catch (error) {
			const rawMessage = error instanceof Error ? error.message : String(error);
			lastValidationError =
				error instanceof z.ZodError
					? formatZodIssuesForRetry(error)
					: rawMessage;
			attempts.push({
				attempt,
				keyName,
				status: "FAIL",
				failureClass: "SEMANTIC_VALIDATION",
				details: redactLlmEvidence(rawMessage).slice(0, 500),
			});
			persist();
			continue;
		}

		try {
			const validated = params.validate
				? params.validate(value)
				: (value as unknown as U);
			attempts.push({ attempt, keyName, status: "PASS" });
			persist();
			return validated;
		} catch (error) {
			lastValidationError =
				error instanceof Error ? error.message : String(error);
			attempts.push({
				attempt,
				keyName,
				status: "FAIL",
				failureClass: "SEMANTIC_VALIDATION",
				details: redactLlmEvidence(lastValidationError).slice(0, 500),
			});
			persist();
		}
	}

	if (lastFailureWasQuota) {
		throw new QuotaExhaustionError(
			`CRITICAL: ${params.name} failed after ${maxAttempts} attempts due to rate limit/quota exhaustion.`,
		);
	}
	throw new Error(
		`STRUCTURED_OUTPUT_VALIDATION_EXHAUSTED: ${params.name}: ${lastValidationError ?? "provider attempts exhausted"}`,
	);
}

export class AssetStore {
	runDir: string;
	cfg: AppConfig;
	domainId: string;

	constructor(runId: string) {
		if (!runId.includes("/")) {
			throw new Error(
				`CRITICAL: Naming Boundary Violation. runId must be 'domain_id/run_id', got: '${runId}'`,
			);
		}
		const [domainId, id] = runId.split("/");
		if (!domainId || !id) {
			throw new Error(`CRITICAL: Malformed runId: '${runId}'`);
		}
		this.domainId = domainId;
		const c = loadConfig(domainId);
		this.cfg = c;
		this.runDir = path.join(ROOT, c.workflow.paths.runs_dir, domainId, id);
		fs.ensureDirSync(this.runDir);
	}
	loadState(): Partial<AgentState> {
		let state: Partial<AgentState> = {};
		const stateJson = path.join(this.runDir, this.cfg.workflow.filenames.state);
		if (fs.existsSync(stateJson)) state = fs.readJsonSync(stateJson);

		const originalScriptLines =
			state.script?.lines?.map((l) => ({ ...l })) || [];

		const stages = [RunStage.RESEARCH, RunStage.CONTENT, RunStage.MEDIA];
		for (const step of stages) {
			const outputPath = path.join(
				this.runDir,
				step,
				this.cfg.workflow.filenames.output,
			);
			if (fs.existsSync(outputPath))
				Object.assign(state, yaml.load(fs.readFileSync(outputPath, "utf-8")));
		}

		const scriptLines = state.script?.lines;
		if (scriptLines && originalScriptLines.length === scriptLines.length) {
			for (let i = 0; i < scriptLines.length; i++) {
				const line = scriptLines[i];
				const origLine = originalScriptLines[i];
				if (line && origLine && line.duration === 0 && origLine.duration > 0) {
					line.duration = origLine.duration;
				}
			}
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
		if (
			process.env.SKIP_LLM === "true" &&
			this.name !== "audit" &&
			this.name !== "auditor"
		) {
			const prev = this.store.load<unknown>(this.name, "output");
			if (prev) return prev as T;
			throw new Error("No previous data for LLM bypass");
		}

		let res: { content: unknown; response_metadata: unknown } | null = null;
		let attempts = 0;
		const maxAttempts = 5;
		let lastKeyName = "unknown";
		let lastFailure: FailureClassification | undefined;
		while (attempts < maxAttempts) {
			const llm = createLlm({
				...this.opts,
				sessionId: this.store.runDir,
			});
			const keyName = llm.keyName || "unknown";
			lastKeyName = keyName;
			const quotaContext = getQuotaContext(keyName, "gemini");
			const finalSystemPrompt = `${systemPrompt}\n\n${quotaContext}`;
			await waitIfRateLimited(keyName);

			try {
				res = await llm.invoke(
					[
						{ role: "system", content: finalSystemPrompt },
						{ role: "user", content: userPrompt },
					],
					callOpts as Record<string, unknown>,
				);
				break;
			} catch (err: unknown) {
				attempts++;
				const errMsg = err instanceof Error ? err.message : String(err);
				const isRateLimit =
					errMsg.includes("429") ||
					errMsg.toLowerCase().includes("quota") ||
					errMsg.toLowerCase().includes("rate limit");
				const isInvalidKey =
					errMsg.toLowerCase().includes("api_key_invalid") ||
					errMsg.toLowerCase().includes("api key not found");
				lastFailure = classifyFailureMessage(errMsg);

				if (isRateLimit || isInvalidKey) {
					const sleepMs = isInvalidKey ? 2000 : 10000;
					Logger.warn(
						"SYSTEM",
						"CORE",
						"LLM_RATE_LIMIT",
						`Error for key ${keyName} (${isInvalidKey ? "invalid key" : "rate limit"}). Attempt ${attempts}/${maxAttempts}. Rotating key and sleeping ${sleepMs / 1000}s... Error: ${redactLlmEvidence(errMsg).slice(0, 150)}`,
					);
					markKeyRateLimited(keyName);
					await new Promise((resolve) => setTimeout(resolve, sleepMs));
				} else {
					throw err;
				}
			}
		}

		if (!res) {
			throw new QuotaExhaustionError(
				`CRITICAL: LLM invocation failed after ${maxAttempts} attempts due to rate limit/quota exhaustion. Cached-output fallback is prohibited.`,
			);
		}

		const metadata = res.response_metadata as Record<string, unknown>;
		if (lastKeyName && lastKeyName !== "unknown") {
			updateFromHeaders(
				lastKeyName,
				(metadata?.headers || {}) as Record<string, unknown>,
			);
		}

		const content = llmContentText(res.content);
		if (!content) {
			throw new Error("LLM response content is empty");
		}
		return parser(content);
	}
}
function cleanCodeBlock(text: string): string {
	if (typeof text !== "string") {
		throw new Error(`Expected string for cleanCodeBlock, got ${typeof text}`);
	}
	const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

	const firstBrace = stripped.indexOf("{");
	const firstBracket = stripped.indexOf("[");
	const lastBrace = stripped.lastIndexOf("}");
	const lastBracket = stripped.lastIndexOf("]");

	let start = -1;
	if (firstBrace !== -1 && firstBracket !== -1) {
		start = Math.min(firstBrace, firstBracket);
	} else if (firstBrace !== -1) {
		start = firstBrace;
	} else if (firstBracket !== -1) {
		start = firstBracket;
	}

	let end = -1;
	if (lastBrace !== -1 && lastBracket !== -1) {
		end = Math.max(lastBrace, lastBracket);
	} else if (lastBrace !== -1) {
		end = lastBrace;
	} else if (lastBracket !== -1) {
		end = lastBracket;
	}

	if (start !== -1 && end !== -1 && end > start) {
		return stripped.slice(start, end + 1).trim();
	}

	if (start !== -1) {
		return stripped.slice(start).trim();
	}

	return stripped;
}

function repairJson(text: string): string {
	let cleaned = cleanCodeBlock(text);

	if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
		return cleaned;
	}

	let inString = false;
	let escaped = false;
	let lastValidIndex = -1;
	const stack: string[] = [];

	for (let i = 0; i < cleaned.length; i++) {
		const char = cleaned[i];
		if (char === '"' && !escaped) {
			inString = !inString;
		}
		escaped = char === "\\" && !escaped;

		if (!inString) {
			if (char === "{") stack.push("}");
			else if (char === "[") stack.push("]");
			else if (char === "}" || char === "]") {
				if (stack.length > 0 && stack[stack.length - 1] === char) {
					stack.pop();
					if (stack.length === 0) lastValidIndex = i;
				}
			}
		}
	}

	if (lastValidIndex !== -1 && lastValidIndex < cleaned.length - 1) {
		const remainder = cleaned.slice(lastValidIndex + 1).trim();
		if (
			remainder.length > 0 &&
			!remainder.startsWith(",") &&
			!remainder.startsWith(":")
		) {
			cleaned = cleaned.slice(0, lastValidIndex + 1);
		}
	}

	if (inString) cleaned += '"';

	while (stack.length > 0) {
		cleaned += stack.pop();
	}

	cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");

	return cleaned;
}

export function parseLlmJson<T>(text: string, schema?: z.ZodSchema<T>): T {
	const repaired = repairJson(text);
	try {
		const json = JSON.parse(repaired);
		return schema ? schema.parse(json) : (json as T);
	} catch (err) {
		Logger.error(
			"SYSTEM",
			"CORE",
			"PARSE_FAIL",
			`Failed to parse JSON. Error: ${err instanceof Error ? err.message : String(err)}`,
		);
		Logger.error("SYSTEM", "CORE", "PARSE_FAIL", `Original Text:\n${text}`);
		Logger.error("SYSTEM", "CORE", "PARSE_FAIL", `Repaired Text:\n${repaired}`);
		throw err;
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
	return getRunIdDateString();
}
export function getRunIdDateString(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}
export function getLoopMemoryFile(store: AssetStore): string {
	return path.join(ROOT, "data", "memory", store.domainId, "loop_journal.json");
}

export function appendLoopMemory(
	store: AssetStore,
	entry: LoopMemoryEntry,
): void {
	const file = getLoopMemoryFile(store);
	const dir = path.dirname(file);
	const data = fs.existsSync(file)
		? (fs.readJsonSync(file) as { entries?: LoopMemoryEntry[] })
		: { entries: [] as LoopMemoryEntry[] };

	const entries = Array.isArray(data.entries) ? data.entries : [];
	const nextEntry = {
		...entry,
		timestamp: entry.timestamp || new Date().toISOString(),
	};
	const deduped = entries.filter(
		(existing) =>
			!(
				existing.run_id === nextEntry.run_id &&
				existing.stage === nextEntry.stage &&
				existing.kind === nextEntry.kind &&
				existing.summary === nextEntry.summary
			),
	);
	const capped = [...deduped, nextEntry].slice(-30);
	fs.ensureDirSync(dir);
	fs.writeJsonSync(file, { entries: capped }, { spaces: 2 });
}

export function fetchRecentThemes(store: AssetStore, days = 7): string {
	const cfg = store.cfg;
	const runsDir = path.join(ROOT, cfg.workflow.paths.runs_dir, store.domainId);

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
			} else if (
				output.director_data &&
				typeof output.director_data === "object" &&
				"angle" in output.director_data
			) {
				const angle = String(
					(output.director_data as { angle?: unknown }).angle ?? "",
				).toLowerCase();
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
