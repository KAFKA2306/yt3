
import { StateGraph, START, END } from "@langchain/langgraph";
import { AssetStore } from "./asset.js";
import { DirectorAgent } from "./agents/director.js";
import { ReporterAgent } from "./agents/reporter.js";
import { ScriptAgent } from "./agents/script.js";
import { AudioAgent } from "./agents/audio.js";
import { VideoAgent } from "./agents/video.js";
import { ThumbnailAgent } from "./agents/thumbnail.js";
import { MetadataAgent } from "./agents/metadata.js";
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
    audio_paths: { reducer: (x: string[], y: string[]) => [...x, ...y], default: () => [] },
    video_path: { reducer: (x: string, y: string) => y, default: () => "" },
    thumbnail_path: { reducer: (x: string, y: string) => y, default: () => "" },
    status: { reducer: (x: string, y: string) => y, default: () => "idle" },
    publish_results: { reducer: (x: any, y: any) => y, default: () => undefined },
};



export function createGraph(store: AssetStore) {
    const director = new DirectorAgent(store);
    const reporter = new ReporterAgent(store);
    const scriptAgent = new ScriptAgent(store);
    const audioAgent = new AudioAgent(store);
    const videoAgent = new VideoAgent(store);
    const thumbnailAgent = new ThumbnailAgent(store);
    const metadataAgent = new MetadataAgent(store);
    const publishAgent = new PublishAgent(store);

    const workflow = new StateGraph<AgentState>({ channels });

    workflow.addNode("director", async (state) => {
        const data = await director.run(state.bucket);
        return { director_data: data };
    });

    workflow.addNode("reporter", async (state) => {
        const news = await reporter.run(state.bucket, state.limit);
        return { news };
    });

    workflow.addNode("script_node", async (state) => {
        const script = await scriptAgent.run(state.news!, state.director_data!);
        return { script };
    });

    workflow.addNode("metadata_node", async (state) => {
        const metadata = await metadataAgent.run(state.news!, state.script!);
        return { metadata };
    });

    workflow.addNode("audio", async (state) => {
        const paths = await audioAgent.run(state.script!);
        return { audio_paths: paths };
    });

    workflow.addNode("thumbnail", async (state) => {
        // Use thumbnail_title from metadata if available
        const scriptForThumb = { ...state.script!, title: state.metadata?.thumbnail_title || state.script!.title };
        const path = await thumbnailAgent.run(scriptForThumb);
        return { thumbnail_path: path };
    });

    workflow.addNode("video", async (state) => {
        const path = await videoAgent.run(state.audio_paths!, state.thumbnail_path!);
        return { video_path: path };
    });

    workflow.addNode("publish", async (state) => {
        const results = await publishAgent.run(state);
        return { publish_results: results, status: "completed" };
    });

    const graphBuilder = workflow as any;
    graphBuilder.addEdge(START, "director");
    graphBuilder.addEdge("director", "reporter");
    graphBuilder.addEdge("reporter", "script_node");
    graphBuilder.addEdge("script_node", "metadata_node");
    graphBuilder.addEdge("metadata_node", "audio");
    graphBuilder.addEdge("metadata_node", "thumbnail");
    graphBuilder.addEdge("audio", "video");
    graphBuilder.addEdge("thumbnail", "video");
    graphBuilder.addEdge("video", "publish");
    graphBuilder.addEdge("publish", END);

    return workflow.compile();
}
