import { END, START, StateGraph } from "@langchain/langgraph";
import { ScriptSmith } from "./agents/content.js";
import { VisualDirector } from "./agents/media.js";
import { MemoryAgent } from "./agents/memory.js";
import { PublishAgent } from "./agents/publish.js";
import { TrendScout } from "./agents/research.js";
import type { AssetStore } from "./core.js";
import type { AgentState, DirectorData, Metadata, PublishResults, Script } from "./types.js";
import { AgentLogger } from "./utils/logger.js";

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
    bucket: { reducer, default: () => cfg.workflow.default_bucket || "global_macro" },
    limit: { reducer, default: () => cfg.steps.research?.default_limit || 3 },
    director_data: { reducer, default: () => undefined } as ChannelReducer<
      DirectorData | undefined
    >,
    news: { reducer, default: () => [] },
    script: { reducer, default: () => undefined } as ChannelReducer<Script | undefined>,
    metadata: { reducer, default: () => undefined } as ChannelReducer<Metadata | undefined>,
    audio_paths: { reducer, default: () => [] },
    video_path: { reducer, default: () => "" },
    thumbnail_path: { reducer, default: () => "" },
    status: { reducer, default: () => "idle" },
    publish_results: { reducer, default: () => undefined } as ChannelReducer<
      PublishResults | undefined
    >,
    memory_context: { reducer, default: () => "" },
    evaluation: { reducer, default: () => undefined },
    retries: { reducer, default: () => 0 },
  };

  const research = new TrendScout(store);
  const content = new ScriptSmith(store);
  const media = new VisualDirector(store);
  const publish = new PublishAgent(store);
  const memory = new MemoryAgent(store);
  const workflow = new StateGraph<AgentState>({ channels });

  workflow.addNode("research", async (state: AgentState) => {
    AgentLogger.transition("SYSTEM", "START", "RESEARCH", "Starting trend discovery");
    const res = await research.run(state.bucket, state.limit);
    return { director_data: res.director_data, news: res.news, memory_context: res.memory_context };
  });

  workflow.addNode("content", async (state: AgentState) => {
    AgentLogger.transition("SYSTEM", "RESEARCH", "CONTENT", "Synthesizing script and metadata");
    if (!state.director_data) throw new Error("director_data is required for content stage");
    const res = await content.run(
      state.news || [],
      state.director_data,
      state.memory_context || "",
    );
    return { script: res.script, metadata: res.metadata };
  });

  workflow.addNode("media", async (state: AgentState) => {
    AgentLogger.transition("SYSTEM", "CONTENT", "MEDIA", "Generating audio and video assets");
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

  workflow.addNode("memory", async (state: AgentState) => {
    AgentLogger.transition("SYSTEM", "PUBLISH", "MEMORY", "Updating memory with run results");
    await memory.run(state);
    return { status: "completed" };
  });

  const graph = workflow as { addEdge: (from: string, to: string) => void; compile: () => unknown };
  graph.addEdge(START, "research");
  graph.addEdge("research", "content");
  graph.addEdge("content", "media");
  graph.addEdge("media", "publish");
  graph.addEdge("publish", "memory");
  graph.addEdge("memory", END);

  return workflow.compile();
}
