import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { AppConfig } from "../../domain/types.js";
import { loadConfig } from "../base.js";
import { AgentLogger as Logger } from "../utils/logger.js";
import { acquireKey } from "../utils/quota/manager.js";

const cfg = loadConfig() as AppConfig;

export function createLlm(options: {
	model?: string;
	temperature?: number;
	sessionId?: string;
	extra?: Record<string, unknown>;
}): BaseChatModel & { keyName?: string } {
	const { key: apiKey, name: keyName } = acquireKey(options.sessionId);
	Logger.info("SYSTEM", "CORE", "API_CHECK", `Key: ${keyName}`);

	const llm = new ChatGoogleGenerativeAI({
		model: (options.model as string) || cfg.providers.llm.gemini.model,
		apiKey,
		temperature: options.temperature ?? cfg.providers.llm.gemini.temperature,
		maxOutputTokens: cfg.providers.llm.gemini.max_tokens,
		...options.extra,
	});

	(llm as unknown as { keyName: string }).keyName = keyName;
	return llm as unknown as BaseChatModel & { keyName?: string };
}
