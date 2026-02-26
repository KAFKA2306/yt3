import path from "node:path";
import fs from "fs-extra";
import {
	type AssetStore,
	BaseAgent,
	RunStage,
	loadConfig,
	parseLlmJson,
} from "../core.js";
import {
	ContentOutlineSchema,
	ContentSegmentSchema,
	MetadataSchema,
	type ContentOutline,
	type ContentResult,
	type Metadata,
	type NewsItem,
	type ScriptLine,
} from "../types.js";

export class ScriptSmith extends BaseAgent {
	constructor(store: AssetStore) {
		const cfg = loadConfig();
		super(store, RunStage.CONTENT, {
			temperature: cfg.providers.llm.content?.temperature || 0.4,
		});
	}

	async run(
		news: NewsItem[],
		director: { angle: string; title_hook: string },
		context: string,
	): Promise<ContentResult> {
		const outputPath = path.join(
			this.store.runDir,
			this.name,
			this.store.cfg.workflow.filenames.output,
		);
		if (fs.existsSync(outputPath)) {
			const res = this.store.load<ContentResult>(this.name, "output");
			if (!res) throw new Error("No content output found");
			this.logOutput(res);
			return res;
		}

		this.logInput({ news, director, context });

		const newsContext = news
			.map((n) => `Title: ${n.title}\nSource: ${n.url}\nSummary: ${n.summary}`)
			.join("\n\n");

		// 1. Generate Outline
		const outline = await this.generateOutline(director.angle, newsContext);

		// 2. Generate Segments
		const allLines: ScriptLine[] = [];
		for (const section of outline.sections) {
			const segmentLines = await this.generateSegment(
				director.angle,
				section,
				allLines.slice(-10), // Context for flow
				newsContext,
			);
			allLines.push(...segmentLines);
		}

		// 3. Generate Metadata
		const scriptText = allLines.map((l) => `${l.speaker}: ${l.text}`).join("\n");
		const metadata = await this.generateMetadata(scriptText, newsContext);

		const result: ContentResult = {
			script: {
				title: outline.title,
				description: metadata.description,
				lines: allLines,
				total_duration: 0,
			},
			metadata,
		};

		this.logOutput(result);
		return result;
	}

	private async generateOutline(
		angle: string,
		newsContext: string,
	): Promise<ContentOutline> {
		const prompts = this.loadPrompt<any>(this.name);
		return this.runLlm(
			prompts.outline.system,
			prompts.outline.user_template
				.replace("{angle}", angle)
				.replace("{news_context}", newsContext),
			(text) => parseLlmJson(text, ContentOutlineSchema),
		);
	}

	private async generateSegment(
		angle: string,
		section: ContentOutline["sections"][0],
		prevLines: ScriptLine[],
		newsContext: string,
	): Promise<ScriptLine[]> {
		const prompts = this.loadPrompt<any>(this.name);
		const prevContext =
			prevLines.length > 0
				? prevLines.map((l) => `${l.speaker}: ${l.text}`).join("\n")
				: "（対話開始）";

		const res = await this.runLlm(
			prompts.segment.system,
			prompts.segment.user_template
				.replace("{angle}", angle)
				.replace("{section_title}", section.title)
				.replace("{key_points}", section.key_points.join(", "))
				.replace("{duration}", section.estimated_duration.toString())
				.replace("{previous_context}", prevContext)
				.replace("{news_context}", newsContext),
			(text) => parseLlmJson(text, ContentSegmentSchema),
		);

		return res.lines.map((l) => ({
			speaker: l.speaker,
			text: l.text,
			duration: 0,
		}));
	}

	private async generateMetadata(
		scriptText: string,
		newsSources: string,
	): Promise<Metadata> {
		const prompts = this.loadPrompt<any>(this.name);
		return this.runLlm(
			prompts.metadata.system,
			prompts.metadata.user_template
				.replace("{script_text}", scriptText)
				.replace("{news_sources}", newsSources),
			(text) => parseLlmJson(text, MetadataSchema),
		);
	}
}
