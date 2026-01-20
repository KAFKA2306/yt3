
import { AssetStore } from "../asset.js";
import { createLlm, loadPrompt } from "../config.js";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

export abstract class BaseAgent {
    store: AssetStore;
    llm: ChatGoogleGenerativeAI;
    name: string;
    defaultOpts: any;

    constructor(store: AssetStore, name: string, llmOpts: any = {}) {
        this.store = store;
        this.name = name;
        this.defaultOpts = llmOpts;
        this.llm = createLlm(llmOpts);
    }

    async runLlm<T>(system: string, user: string, parser: (text: string) => T, opts: any = {}): Promise<T> {
        const llm = Object.keys(opts).length > 0 ? createLlm({ ...this.defaultOpts, ...opts }) : this.llm;
        const messages = [
            { role: "system", content: system },
            { role: "user", content: user },
        ];
        const res = await llm.invoke(messages);
        this.store.save(this.name, "raw_response", { content: res.content });
        const parsed = parser(res.content as string);
        this.store.logOutput(this.name, parsed);
        return parsed;
    }

    loadPrompt(name: string) { return loadPrompt(name); }
    logInput(data: any) { this.store.logInput(this.name, data); }
}
