import path from "node:path";
import fs from "fs-extra";
import {
	type AssetStore,
	BaseAgent,
	AgentLogger as Logger,
	RunStage,
	loadConfig,
	parseLlmJson,
} from "../../io/core.js";
import {
	type ContentOutline,
	ContentOutlineSchema,
	type ContentResult,
	ContentSegmentSchema,
	type Metadata,
	MetadataSchema,
	type NewsItem,
	type ScriptLine,
	type StrategicAnalysis,
} from "../types.js";

interface ContentPrompts {
	outline: { system: string; user_template: string };
	segment: { system: string; user_template: string };
	metadata: { system: string; user_template: string };
}

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
		strategic_insight?: StrategicAnalysis,
	): Promise<ContentResult> {
		const outputPath = path.join(
			this.store.runDir,
			this.name,
			this.store.cfg.workflow.filenames.output,
		);
		if (fs.existsSync(outputPath)) {
			// biome-ignore lint/suspicious/noExplicitAny: Config is dynamic
			const cfg: any = this.store.cfg;
			const res = this.store.load<ContentResult>(this.name, "output");
			if (!res) throw new Error("No content output found");
			this.logOutput(res);
			return res;
		}

		this.logInput({ news, director, context, strategic_insight });

		const newsContext = news
			.map((n) => `Title: ${n.title}\nSource: ${n.url}\nSummary: ${n.summary}`)
			.join("\n\n");

		const insightContext = strategic_insight
			? `\n\n**【投資戦略的示唆 (Chief Strategist's Insight)】**\n戦略要約: ${strategic_insight.strategic_summary}\n主要な知恵:\n${strategic_insight.insights.map((i: { wisdom: string }) => `- ${i.wisdom}`).join("\n")}`
			: "";

		const fullContext = newsContext + insightContext;

		// 1. Generate Outline
		const outline = await this.generateOutline(director.angle, fullContext);
		Logger.info(
			this.name,
			"CONTENT",
			"OUTLINE_GEN",
			`Generated outline: ${outline.title}`,
		);

		// 2. Generate Segments
		let allLines: ScriptLine[] = [];
		for (const section of outline.sections) {
			const segmentLines = await this.generateSegment(
				director.angle,
				section,
				allLines.slice(-10), // Context for flow
				fullContext,
			);
			allLines = [...allLines, ...segmentLines];
		}

		// 3. Generate Metadata
		const scriptText = allLines
			.map((l) => `${l.speaker}: ${l.text}`)
			.join("\n");
		const metadata = await this.generateMetadata(scriptText, fullContext);

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
		const prompts = this.loadPrompt<ContentPrompts>(this.name);
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
		const prompts = this.loadPrompt<ContentPrompts>(this.name);
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
		const prompts = this.loadPrompt<ContentPrompts>(this.name);
		return this.runLlm(
			prompts.metadata.system,
			prompts.metadata.user_template
				.replace("{script_text}", scriptText)
				.replace("{news_sources}", newsSources),
			(text) => parseLlmJson(text, MetadataSchema),
		);
	}
}
