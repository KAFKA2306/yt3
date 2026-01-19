
import { StateGraph } from "@langchain/langgraph";
import { AssetStore } from "./asset.js";
import { DirectorAgent } from "./agents/director.js";
import { ReporterAgent } from "./agents/reporter.js";
import { ScriptAgent } from "./agents/script.js";
import { AudioAgent } from "./agents/audio.js";
import { VideoAgent } from "./agents/video.js";
import { ThumbnailAgent } from "./agents/thumbnail.js";
import { MetadataAgent } from "./agents/metadata.js";
import { AgentState } from "./state.js";

const channels: any = {
    run_id: { reducer: (x: string, y: string) => y, default: () => "" },
    bucket: { reducer: (x: string, y: string) => y, default: () => "General" },
    limit: { reducer: (x: number, y: number) => y, default: () => 3 },
    news: { reducer: (x: any, y: any) => y, default: () => [] },
    script: { reducer: (x: any, y: any) => y, default: () => undefined },
    metadata: { reducer: (x: any, y: any) => y, default: () => undefined },
    audio_paths: { reducer: (x: string[], y: string[]) => [...x, ...y], default: () => [] },
    video_path: { reducer: (x: string, y: string) => y, default: () => "" },
    thumbnail_path: { reducer: (x: string, y: string) => y, default: () => "" },
    status: { reducer: (x: string, y: string) => y, default: () => "idle" },
};

export function createGraph(store: AssetStore) {
    const director = new DirectorAgent(store);
    const reporter = new ReporterAgent(store);
    const scriptAgent = new ScriptAgent(store);
    const audioAgent = new AudioAgent(store);
    const videoAgent = new VideoAgent(store);
    const thumbnailAgent = new ThumbnailAgent(store);
    const metadataAgent = new MetadataAgent(store);

    const workflow = new StateGraph<AgentState>({ channels });

    workflow.addNode("director", async (state) => {
        const data = await director.run(state.bucket);
        return { director_data: data };
    });

    workflow.addNode("reporter", async (state) => {
        const news = await reporter.run(state.bucket, state.limit);
        return { news };
    });

    workflow.addNode("script", async (state) => {
        const script = await scriptAgent.run(state.news, state.director_data);
        return { script };
    });

    workflow.addNode("metadata", async (state) => {
        const metadata = await metadataAgent.run(state.news, state.script);
        return { metadata };
    });

    workflow.addNode("audio", async (state) => {
        const paths = await audioAgent.run(state.script);
        return { audio_paths: paths };
    });

    workflow.addNode("thumbnail", async (state) => {
        // Use thumbnail_title from metadata if available
        const scriptForThumb = { ...state.script, title: state.metadata?.thumbnail_title || state.script.title };
        const path = await thumbnailAgent.run(scriptForThumb);
        return { thumbnail_path: path };
    });

    workflow.addNode("video", async (state) => {
        const path = await videoAgent.run(state.audio_paths, state.thumbnail_path);
        return { video_path: path, status: "completed" };
    });

    workflow.addEdge("__start__", "director");
    workflow.addEdge("director", "reporter");
    workflow.addEdge("reporter", "script");
    workflow.addEdge("script", "metadata");
    workflow.addEdge("metadata", "audio");
    workflow.addEdge("metadata", "thumbnail");
    workflow.addEdge("audio", "video");
    workflow.addEdge("thumbnail", "video");
    workflow.addEdge("video", "__end__");

    return workflow.compile();
}
