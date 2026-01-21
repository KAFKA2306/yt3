import { StateGraph, START, END } from "@langchain/langgraph";
import { AssetStore } from "./core.js";
import { ResearchAgent } from "./agents/research.js";
import { ContentAgent } from "./agents/content.js";
import { MediaAgent } from "./agents/media.js";
import { MemoryAgent } from "./agents/memory.js";
import { PublishAgent } from "./agents/publish.js";
import { AgentState, DirectorData, Script, Metadata, PublishResults } from "./types.js";

type ChannelReducer<T> = {
    reducer: (x: T, y: T) => T;
    default: () => T;
};

type StateChannels = {
    [K in keyof AgentState]: ChannelReducer<AgentState[K]>;
};

const reducer = <T>(x: T, y: T): T => y;

const channels: StateChannels = {
    run_id: { reducer, default: () => "" },
    bucket: { reducer, default: () => "macro_economy" },
    limit: { reducer, default: () => 3 },
    director_data: { reducer, default: () => undefined } as ChannelReducer<DirectorData | undefined>,
    news: { reducer, default: () => [] },
    script: { reducer, default: () => undefined } as ChannelReducer<Script | undefined>,
    metadata: { reducer, default: () => undefined } as ChannelReducer<Metadata | undefined>,
    audio_paths: { reducer, default: () => [] },
    video_path: { reducer, default: () => "" },
    thumbnail_path: { reducer, default: () => "" },
    status: { reducer, default: () => "idle" },
    publish_results: { reducer, default: () => undefined } as ChannelReducer<PublishResults | undefined>,
    memory_context: { reducer, default: () => "" },
};

export function createGraph(store: AssetStore) {
    const research = new ResearchAgent(store);
    const content = new ContentAgent(store);
    const media = new MediaAgent(store);
    const publish = new PublishAgent(store);
    const memory = new MemoryAgent(store);
    const workflow = new StateGraph<AgentState>({ channels });

    workflow.addNode("research", async (state) => {
        const res = await research.run(state.bucket, state.limit);
        return { director_data: res.director_data, news: res.news, memory_context: res.memory_context };
    });

    workflow.addNode("content", async (state) => {
        const res = await content.run(state.news!, state.director_data!, state.memory_context!);
        return { script: res.script, metadata: res.metadata };
    });

    workflow.addNode("media", async (state) => {
        const res = await media.run(state.script!, state.metadata?.thumbnail_title || state.script!.title);
        return { audio_paths: res.audio_paths, thumbnail_path: res.thumbnail_path, video_path: res.video_path };
    });

    workflow.addNode("publish", async (state) => {
        const res = await publish.run(state);
        return { publish_results: res, status: "published" };
    });

    workflow.addNode("memory", async (state) => {
        await memory.run(state);
        return { status: "completed" };
    });

    const g = workflow as unknown as { addEdge: (from: string, to: string) => void };
    g.addEdge(START, "research");
    g.addEdge("research", "content");
    g.addEdge("content", "media");
    g.addEdge("media", "publish");
    g.addEdge("publish", "memory");
    g.addEdge("memory", END);

    return workflow.compile();
}
