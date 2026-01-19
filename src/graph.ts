
import { StateGraph, END } from "@langchain/langgraph";
import { AgentState } from "./state.js";
import { AssetStore } from "./asset.js";
import { DirectorAgent } from "./agents/director.js";
import { ReporterAgent } from "./agents/reporter.js";
import { ScriptAgent } from "./agents/script.js";
import { AudioAgent } from "./agents/audio.js";
import { VideoAgent } from "./agents/video.js";

// Define channels for StateGraph
const channels = {
    run_id: { reducer: (x: string, y: string) => y || x, default: () => "" },
    bucket: { reducer: (x: string, y: string) => y || x, default: () => "General" },
    limit: { reducer: (x: number, y: number) => y ?? x, default: () => 3 },
    news: { reducer: (x: any, y: any) => y || x, default: () => [] },
    script: { reducer: (x: any, y: any) => y || x, default: () => undefined },
    audio_paths: { reducer: (x: any, y: any) => y || x, default: () => [] },
    video_path: { reducer: (x: string, y: string) => y || x, default: () => "" },
    status: { reducer: (x: string, y: string) => y || x, default: () => "" },
    research_data: { reducer: (x: any, y: any) => y || x, default: () => ({}) },
    trend_data: { reducer: (x: any, y: any) => y || x, default: () => ({}) },
    director_data: { reducer: (x: any, y: any) => y || x, default: () => ({}) },
    knowledge_context: { reducer: (x: any, y: any) => y || x, default: () => ({}) },
};

export function createGraph() {
    // Node definitions
    async function researchNode(state: AgentState) {
        const store = new AssetStore(state.run_id);
        const agent = new DirectorAgent(store);
        const category = state.bucket;
        const result = await agent.run(category);
        return {
            director_data: result,
            bucket: result.search_query || category
        };
    }

    async function searchNode(state: AgentState) {
        const store = new AssetStore(state.run_id);
        const agent = new ReporterAgent(store);
        const query = state.bucket;
        const items = await agent.run(query, state.limit || 3);
        return { news: items };
    }

    async function scriptNode(state: AgentState) {
        const store = new AssetStore(state.run_id);
        const agent = new ScriptAgent(store);
        const script = await agent.run(
            state.news || [],
            state.director_data || {},
            state.knowledge_context || {}
        );
        return { script };
    }

    async function audioNode(state: AgentState) {
        const store = new AssetStore(state.run_id);
        const agent = new AudioAgent(store);
        if (!state.script) throw new Error("No script generated");
        const paths = await agent.run(state.script);
        return { audio_paths: paths };
    }

    async function videoNode(state: AgentState) {
        const store = new AssetStore(state.run_id);
        const agent = new VideoAgent(store);
        if (!state.audio_paths) throw new Error("No audio paths generated");
        const path = await agent.run(state.audio_paths);
        return { video_path: path, status: "completed" };
    }

    // Build workflow
    const workflow = new StateGraph<AgentState>({
        channels: channels as any
    })
        .addNode("director", researchNode)
        .addNode("reporter", searchNode)
        .addNode("script", scriptNode)
        .addNode("audio", audioNode)
        .addNode("video", videoNode)

        // Edges
        .addEdge("__start__", "director")
        .addEdge("director", "reporter")
        .addEdge("reporter", "script")
        .addEdge("script", "audio")
        .addEdge("audio", "video")
        .addEdge("video", "__end__");

    return workflow.compile();
}
