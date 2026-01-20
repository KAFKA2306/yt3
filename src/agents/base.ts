import { AssetStore } from "../asset.js";
import { createLlm, loadPrompt } from "../config.js";

export abstract class BaseAgent {
    store: AssetStore;
    name: string;
    opts: any;

    constructor(store: AssetStore, name: string, opts: any = {}) {
        this.store = store;
        this.name = name;
        this.opts = opts;
    }

    async runLlm<T>(system: string, user: string, parser: (text: string) => T, callOpts: any = {}): Promise<T> {
        if (process.env.SKIP_LLM === "true") return this.store.load(this.name, "output") as T;
        const llm = createLlm({ ...this.opts, ...callOpts });
        const res = await llm.invoke([{ role: "system", content: system }, { role: "user", content: user }]);
        const parsed = parser(res.content as string);
        this.store.save(this.name, "raw_response", { content: res.content });
        this.store.logOutput(this.name, parsed);
        return parsed;
    }

    loadPrompt(name: string) { return loadPrompt(name); }
    logInput(data: any) { this.store.logInput(this.name, data); }
}
