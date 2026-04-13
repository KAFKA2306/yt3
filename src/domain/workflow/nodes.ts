import { AgentLogger } from "../../io/utils/logger.js";
import type { ScriptSmith } from "../agents/content.js";
import type { DexterJPAgent } from "../agents/dexter_jp.js";
import type { MacroRegimeAnalystAgent } from "../agents/macro_regime_analyst_agent.js";
import type { VisualDirector } from "../agents/media.js";
import type { MemoryAgent } from "../agents/memory.js";
import type { NotebookLMAgent } from "../agents/notebooklm.js";
import type { PublishAgent } from "../agents/publish.js";
import type { TrendScout } from "../agents/research.js";
import type { WebSearchAgent } from "../agents/web_search.js";
import type { AgentState, AppConfig } from "../types.js";

export interface GraphAgents {
	research: TrendScout;
	dexterJp: DexterJPAgent;
	webSearch: WebSearchAgent;
	strategy: MacroRegimeAnalystAgent;
	content: ScriptSmith;
	media: VisualDirector;
	publish: PublishAgent;
	notebooklm: NotebookLMAgent;
	memory: MemoryAgent;
}

export class WorkflowNodes {
	constructor(
		private agents: GraphAgents,
		private cfg: AppConfig,
	) {}

	async research(state: AgentState) {
		AgentLogger.info("SYSTEM", "START", "RESEARCH", "Starting trend discovery");
		const res = await this.agents.research.run(
			state.bucket,
			state.limit,
			state.mission_file,
		);
		return {
			director_data: res.director_data,
			news: res.news,
			memory_context: res.memory_context,
		};
	}

	async strategy(state: AgentState) {
		AgentLogger.info(
			"SYSTEM",
			"RESEARCH",
			"STRATEGY",
			"Extracting strategic insights",
		);
		const res = await this.agents.strategy.run(state.news || []);
		return { strategic_insight: res };
	}

	async content(state: AgentState) {
		AgentLogger.info("SYSTEM", "STRATEGY", "CONTENT", "Synthesizing script");
		if (!state.director_data) throw new Error("director_data is required");
		const res = await this.agents.content.run(
			state.news || [],
			state.director_data,
			state.memory_context || "",
			state.strategic_insight,
		);
		return { script: res.script, metadata: res.metadata };
	}

	async media(state: AgentState) {
		AgentLogger.info("SYSTEM", "CONTENT", "MEDIA", "Generating assets");
		if (!state.script) throw new Error("script is required");
		const res = await this.agents.media.run(
			state.script,
			state.metadata?.thumbnail_title || state.script.title,
		);
		return {
			audio_paths: res.audio_paths,
			thumbnail_path: res.thumbnail_path,
			video_path: res.video_path,
		};
	}

	async publish(state: AgentState) {
		AgentLogger.info("SYSTEM", "MEDIA", "PUBLISH", "Uploading video");
		const res = await this.agents.publish.run(state);
		return { publish_results: res, status: "published" };
	}

	async notebooklm(_state: AgentState) {
		AgentLogger.info(
			"SYSTEM",
			"PUBLISH",
			"NOTEBOOKLM",
			"Generating NotebookLM videos",
		);
		const ids = this.cfg.agents?.notebooklm?.notebook_ids || [];
		const style = this.cfg.agents?.notebooklm?.video_style || "whiteboard";
		const res = await this.agents.notebooklm.run(ids, style);
		return { notebook_videos: res };
	}

	async parallel_research(state: AgentState) {
		AgentLogger.info(
			"SYSTEM",
			"NOTEBOOKLM",
			"PARALLEL_RESEARCH",
			"Running parallel research",
		);
		const notebooks = state.notebook_videos?.videos || [];
		const theme =
			notebooks.length > 0
				? notebooks[0]?.notebook_title || "Market Analysis"
				: "Financial Market Analysis";
		const [dexterResults, webResults] = await Promise.all([
			this.agents.dexterJp.run(theme, 3),
			this.agents.webSearch.run(theme, 5),
		]);
		const insights = [
			...dexterResults.map((f) => `${f.company || "Company"}: ${f.summary}`),
			...webResults.map((r) => `${r.title}: ${r.snippet}`),
		].join(" | ");
		return {
			enriched_research: {
				research_theme: theme,
				dexter_jp_findings: dexterResults,
				web_search_results: webResults,
				combined_insights: insights,
				generated_at: new Date().toISOString(),
			},
		};
	}

	async memory(state: AgentState) {
		AgentLogger.info(
			"SYSTEM",
			"PARALLEL_RESEARCH",
			"MEMORY",
			"Updating memory",
		);
		await this.agents.memory.run(state);
		return { status: "completed" };
	}
}
