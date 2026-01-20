
import { StateGraph, START, END } from "@langchain/langgraph";
import { AssetStore } from "./asset.js";
import { ResearchAgent } from "./agents/research.js";
import { ContentAgent } from "./agents/content.js";
import { MediaAgent } from "./agents/media.js";
import { PublishAgent } from "./agents/publish.js";
import { AgentState } from "./state.js";

const channels: any = {
    run_id: { reducer: (x: string, y: string) => y, default: () => "" },
    bucket: { reducer: (x: string, y: string) => y, default: () => "General" },
    limit: { reducer: (x: number, y: number) => y, default: () => 3 },
    director_data: { reducer: (x: any, y: any) => y, default: () => undefined },
    news: { reducer: (x: any, y: any) => y, default: () => [] },
    script: { reducer: (x: any, y: any) => y, default: () => undefined },
    metadata: { reducer: (x: any, y: any) => y, default: () => undefined },
    audio_paths: { reducer: (x: string[], y: string[]) => y, default: () => [] },
    video_path: { reducer: (x: string, y: string) => y, default: () => "" },
    thumbnail_path: { reducer: (x: string, y: string) => y, default: () => "" },
    status: { reducer: (x: string, y: string) => y, default: () => "idle" },
    publish_results: { reducer: (x: any, y: any) => y, default: () => undefined },
};

export function createGraph(store: AssetStore) {
    const research = new ResearchAgent(store);
    const content = new ContentAgent(store);
    const media = new MediaAgent(store);
    const publish = new PublishAgent(store);

    const workflow = new StateGraph<AgentState>({ channels });

    // Research: memory search + web search + angle selection
    workflow.addNode("research", async (state) => {
        const result = await research.run(state.bucket, state.limit);
        return { director_data: result.director_data, news: result.news };
    });

    // Content: script + metadata generation
    workflow.addNode("content", async (state) => {
        const result = await content.run(state.news!, state.director_data!);
        return { script: result.script, metadata: result.metadata };
    });

    // Media: audio + thumbnail + video
    workflow.addNode("media", async (state) => {
        const thumbTitle = state.metadata?.thumbnail_title || state.script!.title;
        const result = await media.run(state.script!, thumbTitle);
        return { audio_paths: result.audio_paths, thumbnail_path: result.thumbnail_path, video_path: result.video_path };
    });

    // Publish: YouTube + Twitter
    workflow.addNode("publish", async (state) => {
        const results = await publish.run(state);
        return { publish_results: results, status: "completed" };
    });

    const g = workflow as any;
    g.addEdge(START, "research");
    g.addEdge("research", "content");
    g.addEdge("content", "media");
    g.addEdge("media", "publish");
    g.addEdge("publish", END);

    return workflow.compile();
}
