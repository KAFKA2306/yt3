
import { AssetStore } from "../asset.js";
import { createLlm, loadPrompt } from "../config.js";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { parseLlmContent } from "../utils.js";
import yaml from "js-yaml";

export abstract class BaseAgent {
    store: AssetStore;
    llm: ChatGoogleGenerativeAI;
    name: string;

    constructor(store: AssetStore, name: string, llmOpts: any = {}) {
        this.store = store;
        this.name = name;
        this.llm = createLlm(llmOpts);
    }

    async runLlm<T>(system: string, user: string, parser: (text: string) => T): Promise<T> {
        const messages = [
            { role: "system", content: system },
            { role: "user", content: user },
        ];
        const res = await this.llm.invoke(messages);
        this.store.save(this.name, "raw_response", { content: res.content });
        const parsed = parser(res.content as string);
        this.store.logOutput(this.name, parsed);
        return parsed;
    }


    loadPrompt(name: string) { return loadPrompt(name); }
    logInput(data: any) { this.store.logInput(this.name, data); }
}
