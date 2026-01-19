from langgraph.graph import END, StateGraph

from src.agents.audio import AudioAgent
from src.agents.research import ResearchAgent
from src.agents.script import ScriptAgent
from src.agents.search import WebSearchAgent
from src.agents.video import VideoAgent
from src.asset import AssetStore
from src.state import AgentState


def create_graph():
    workflow = StateGraph(AgentState)

    def research_node(state: AgentState) -> dict:
        store = AssetStore(state["run_id"])
        agent = ResearchAgent(store)
        category = state.get("bucket", "General")
        result = agent.run(category=category)
        return {
            "research_data": result,
            "bucket": result.get("search_query", category),
        }

    def search_node(state: AgentState) -> dict:
        store = AssetStore(state["run_id"])
        agent = WebSearchAgent(store)
        query = state["bucket"]
        items = agent.run(query, state.get("limit", 3))
        return {"news": items}

    def script_node(state: AgentState) -> dict:
        store = AssetStore(state["run_id"])
        agent = ScriptAgent(store)
        script = agent.run(
            state["news"],
            director_data=state.get("research_data", {}),
            knowledge_context={},
        )
        return {"script": script}

    def audio_node(state: AgentState) -> dict:
        store = AssetStore(state["run_id"])
        agent = AudioAgent(store)
        paths = agent.run(state["script"])
        return {"audio_paths": paths}

    def video_node(state: AgentState) -> dict:
        store = AssetStore(state["run_id"])
        agent = VideoAgent(store)
        path = agent.run(state["audio_paths"])
        return {"video_path": path, "status": "completed"}

    workflow.add_node("research", research_node)
    workflow.add_node("search", search_node)
    workflow.add_node("script", script_node)
    workflow.add_node("audio", audio_node)
    workflow.add_node("video", video_node)

    workflow.set_entry_point("research")
    workflow.add_edge("research", "search")
    workflow.add_edge("search", "script")
    workflow.add_edge("script", "audio")
    workflow.add_edge("audio", "video")
    workflow.add_edge("video", END)

    return workflow.compile()
