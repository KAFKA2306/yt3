from langgraph.graph import END, StateGraph

from src.agents.audio import AudioAgent
from src.agents.script import ScriptAgent
from src.agents.search import WebSearchAgent
from src.agents.trend import TrendAgent
from src.agents.video import VideoAgent
from src.asset import AssetStore
from src.state import AgentState


from src.agents.director import DirectorAgent
from src.agents.knowledge import KnowledgeAgent


def create_graph():
    workflow = StateGraph(AgentState)

    def trend_node(state: AgentState) -> dict:
        store = AssetStore(state["run_id"])
        agent = TrendAgent(store)
        # Default to "General" if no bucket specified, or use bucket as category
        category = state.get("bucket", "General")
        trend = agent.run(category=category)
        return {"trend_data": trend, "bucket": trend.get("search_query", category)}

    def director_node(state: AgentState) -> dict:
        store = AssetStore(state["run_id"])
        agent = DirectorAgent(store)
        strategy = agent.run(state["trend_data"])
        return {"director_data": strategy}

    def knowledge_node(state: AgentState) -> dict:
        store = AssetStore(state["run_id"])
        agent = KnowledgeAgent(store)
        context = agent.run(state["trend_data"], state["director_data"])
        return {"knowledge_context": context}

    def search_node(state: AgentState) -> dict:
        store = AssetStore(state["run_id"])
        agent = WebSearchAgent(store)

        # Merge Director's search keywords with the bucket/trend query
        director_keywords = state.get("director_data", {}).get("search_keywords", [])
        base_query = state["bucket"]

        # If we have director keywords, we might want to run multiple searches or append them.
        # For simplicity, we'll append the first keyword to the base query if available.
        query = base_query
        if director_keywords:
            query = f"{base_query} {director_keywords[0]}"

        items = agent.run(query, state.get("limit", 3))
        return {"news": items}

    def script_node(state: AgentState) -> dict:
        store = AssetStore(state["run_id"])
        agent = ScriptAgent(store)
        script = agent.run(
            state["news"],
            director_data=state.get("director_data", {}),
            knowledge_context=state.get("knowledge_context", {})
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

    workflow.add_node("trend", trend_node)
    workflow.add_node("director", director_node)
    workflow.add_node("knowledge", knowledge_node)
    workflow.add_node("search", search_node)
    workflow.add_node("script", script_node)
    workflow.add_node("audio", audio_node)
    workflow.add_node("video", video_node)

    def route_start(state: AgentState):
        if state.get("trend_mode"):
            return "trend"
        return "search"

    workflow.set_conditional_entry_point(route_start, {"trend": "trend", "search": "search"})

    # RAG Flow: Trend -> Director -> Knowledge -> Search -> Script
    workflow.add_edge("trend", "director")
    workflow.add_edge("director", "knowledge")
    workflow.add_edge("knowledge", "search")
    workflow.add_edge("search", "script")
    workflow.add_edge("script", "audio")
    workflow.add_edge("audio", "video")
    workflow.add_edge("video", END)

    return workflow.compile()
