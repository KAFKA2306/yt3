import { StateGraph, START, END } from "@langchain/langgraph";
import { AssetStore } from "./asset.js";
import { ResearchAgent } from "./agents/research.js";
import { ContentAgent } from "./agents/content.js";
import { MediaAgent } from "./agents/media.js";
import { PublishAgent } from "./agents/publish.js";
import { AgentState } from "./state.js";

const channels: any = {
    run_id: { reducer: (x: any, y: any) => y, default: () => "" },
    bucket: { reducer: (x: any, y: any) => y, default: () => "General" },
    limit: { reducer: (x: any, y: any) => y, default: () => 3 },
    director_data: { reducer: (x: any, y: any) => y, default: () => undefined },
    news: { reducer: (x: any, y: any) => y, default: () => [] },
    script: { reducer: (x: any, y: any) => y, default: () => undefined },
    metadata: { reducer: (x: any, y: any) => y, default: () => undefined },
    audio_paths: { reducer: (x: any, y: any) => y, default: () => [] },
    video_path: { reducer: (x: any, y: any) => y, default: () => "" },
    thumbnail_path: { reducer: (x: any, y: any) => y, default: () => "" },
    status: { reducer: (x: any, y: any) => y, default: () => "idle" },
    publish_results: { reducer: (x: any, y: any) => y, default: () => undefined },
    memory_context: { reducer: (x: any, y: any) => y, default: () => "" },
};

export function createGraph(store: AssetStore) {
    const research = new ResearchAgent(store);
    const content = new ContentAgent(store);
    const media = new MediaAgent(store);
    const publish = new PublishAgent(store);
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
        return { publish_results: res, status: "completed" };
    });

    const g = workflow as any;
    g.addEdge(START, "research");
    g.addEdge("research", "content");
    g.addEdge("content", "media");
    g.addEdge("media", "publish");
    g.addEdge("publish", END);

    return workflow.compile();
}
