import { ContextPlaybook } from "../../domain/ace/context_playbook.js";
import { createLlm } from "../llm/factory.js";
import type { AssetStore } from "../storage/asset_store.js";
import {
	acquireKey,
	getQuotaContext,
	updateFromHeaders,
} from "../utils/quota/manager.js";

export abstract class BaseAgent {
	constructor(
		public store: AssetStore,
		public name: string,
		public opts: Record<string, unknown> = {},
	) {}

	logInput(data: unknown) {
		this.store.save(this.name, "input", data);
	}
	logOutput(data: unknown) {
		this.store.save(this.name, "output", data);
	}

	loadPrompt<T>(name: string): T {
		const p = (this.store.cfg.prompts as Record<string, unknown>)[name];
		if (!p) throw new Error(`Prompt ${name} missing`);
		return p as T;
	}

	async runLlm<T>(
		system: string,
		user: string,
		parser: (t: string) => T,
		opts: Record<string, unknown> = {},
	): Promise<T> {
		const ace = new ContextPlaybook()
			.getRankedBullets(5)
			.map((b) => `- ${b.content}`)
			.join("\n");
		if (process.env.SKIP_LLM === "true")
			return (
				this.store.load<T>(this.name, "output") ||
				(() => {
					throw new Error("No bypass");
				})()
			);

		const llm = createLlm({ ...this.opts, sessionId: this.store.runDir });
		const kn =
			((llm as unknown as Record<string, unknown>).keyName as string) ||
			"unknown";
		const res = await llm.invoke(
			[
				{
					role: "system",
					content: `${system}\n\n[ACE]\n${ace}\n\n${getQuotaContext(kn, "gemini")}`,
				},
				{ role: "user", content: user },
			],
			opts,
		);

		const meta = res.response_metadata as Record<
			string,
			{ headers?: Record<string, unknown> }
		>;
		if (kn && meta?.headers) updateFromHeaders(kn, meta.headers);
		let content: string;
		if (typeof res.content === "string") {
			content = res.content;
		} else if (Array.isArray(res.content)) {
			content = res.content
				.map((c) =>
					typeof c === "string"
						? c
						: "text" in (c as object) &&
								typeof (c as { text: string }).text === "string"
							? (c as { text: string }).text
							: "",
				)
				.join("");
		} else {
			throw new Error("Invalid LLM response content");
		}

		if (!content) {
			throw new Error("LLM response content is empty");
		}
		return parser(content);
	}
}
