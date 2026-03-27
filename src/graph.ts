import { END, START, StateGraph } from "@langchain/langgraph";
import { ScriptSmith } from "./domain/agents/content.js";
import { MacroRegimeAnalystAgent } from "./domain/agents/macro_regime_analyst_agent.js";
import { VisualDirector } from "./domain/agents/media.js";
import { MemoryAgent } from "./domain/agents/memory.js";
import { NotebookLMAgent } from "./domain/agents/notebooklm.js";
import { PublishAgent } from "./domain/agents/publish.js";
import { TrendScout } from "./domain/agents/research.js";
import type {
	AgentState,
	DirectorData,
	Metadata,
	NotebookLMResult,
	PublishResults,
	Script,
	StrategicAnalysis,
} from "./domain/types.js";
import type { AssetStore } from "./io/core.js";
import { AgentLogger } from "./io/utils/logger.js";
type ChannelReducer<T> = {
	reducer: (x: T, y: T) => T;
	default: () => T;
};
type StateChannels = {
	[K in keyof AgentState]: ChannelReducer<AgentState[K]>;
};
const reducer = <T>(_x: T, y: T): T => y;
export function createGraph(store: AssetStore) {
	const cfg = store.cfg;
	const channels: StateChannels = {
		run_id: { reducer, default: () => "" },
		bucket: {
			reducer,
			default: () => cfg.workflow.default_bucket || "daily_pulse",
		},
		limit: { reducer, default: () => cfg.steps.research?.default_limit || 3 },
		director_data: { reducer, default: () => undefined } as ChannelReducer<
			DirectorData | undefined
		>,
		news: { reducer, default: () => [] },
		script: { reducer, default: () => undefined } as ChannelReducer<
			Script | undefined
		>,
		metadata: { reducer, default: () => undefined } as ChannelReducer<
			Metadata | undefined
		>,
		audio_paths: { reducer, default: () => [] },
		video_path: { reducer, default: () => "" },
		thumbnail_path: { reducer, default: () => "" },
		status: { reducer, default: () => "idle" },
		publish_results: { reducer, default: () => undefined } as ChannelReducer<
			PublishResults | undefined
		>,
		memory_context: { reducer, default: () => "" },
		mission_file: { reducer, default: () => undefined } as ChannelReducer<
			string | undefined
		>,
		strategic_insight: { reducer, default: () => undefined } as ChannelReducer<
			StrategicAnalysis | undefined
		>,
		notebook_videos: { reducer, default: () => undefined } as ChannelReducer<
			NotebookLMResult | undefined
		>,
	};
	const research = new TrendScout(store);
	const strategy = new MacroRegimeAnalystAgent(store);
	const content = new ScriptSmith(store);
	const media = new VisualDirector(store);
	const publish = new PublishAgent(store);
	const notebooklm = new NotebookLMAgent(store);
	const memory = new MemoryAgent(store);
	const workflow = new StateGraph<AgentState>({ channels });
	workflow.addNode("research", async (state: AgentState) => {
		AgentLogger.transition(
			"SYSTEM",
			"START",
			"RESEARCH",
			"Starting trend discovery",
		);
		const res = await research.run(
			state.bucket,
			state.limit,
			state.mission_file,
		);
		return {
			director_data: res.director_data,
			news: res.news,
			memory_context: res.memory_context,
		};
	});
	workflow.addNode("strategy", async (state: AgentState) => {
		AgentLogger.transition(
			"SYSTEM",
			"RESEARCH",
			"STRATEGY",
			"Extracting strategic insights from news",
		);
		const res = await strategy.run(state.news || []);
		return { strategic_insight: res };
	});
	workflow.addNode("content", async (state: AgentState) => {
		AgentLogger.transition(
			"SYSTEM",
			"STRATEGY",
			"CONTENT",
			"Synthesizing script and metadata",
		);
		if (!state.director_data)
			throw new Error("director_data is required for content stage");
		const res = await content.run(
			state.news || [],
			state.director_data,
			state.memory_context || "",
			state.strategic_insight,
		);
		return { script: res.script, metadata: res.metadata };
	});
	workflow.addNode("media", async (state: AgentState) => {
		AgentLogger.transition(
			"SYSTEM",
			"CONTENT",
			"MEDIA",
			"Generating audio and video assets",
		);
		if (!state.script) throw new Error("script is required for media stage");
		const res = await media.run(
			state.script,
			state.metadata?.thumbnail_title || state.script.title,
		);
		return {
			audio_paths: res.audio_paths,
			thumbnail_path: res.thumbnail_path,
			video_path: res.video_path,
		};
	});
	workflow.addNode("publish", async (state: AgentState) => {
		AgentLogger.transition(
			"SYSTEM",
			"MEDIA",
			"PUBLISH",
			"Uploading video to YouTube and social channels",
		);
		const res = await publish.run(state);
		return { publish_results: res, status: "published" };
	});
	workflow.addNode("notebooklm", async (state: AgentState) => {
		AgentLogger.transition(
			"SYSTEM",
			"PUBLISH",
			"NOTEBOOKLM",
			"Generating NotebookLM videos",
		);
		// Extract notebook IDs from config or state; default to empty array
		const notebookIds: string[] = [];
		const videoStyle = cfg.agents?.notebooklm?.video_style || "whiteboard";
		const res = await notebooklm.run(notebookIds, videoStyle);
		return { notebook_videos: res };
	});
	workflow.addNode("memory", async (state: AgentState) => {
		AgentLogger.transition(
			"SYSTEM",
			"NOTEBOOKLM",
			"MEMORY",
			"Updating memory with run results",
		);
		await memory.run(state);
		return { status: "completed" };
	});
	// biome-ignore lint/suspicious/noExplicitAny: StateGraph type complexity
	const graph = workflow as any;
	graph.addEdge(START, "research");
	graph.addEdge("research", "strategy");
	graph.addEdge("strategy", "content");
	graph.addEdge("content", "media");
	graph.addEdge("media", "publish");
	graph.addEdge("publish", "notebooklm");
	graph.addEdge("notebooklm", "memory");
	graph.addEdge("memory", END);
	return workflow.compile();
}
