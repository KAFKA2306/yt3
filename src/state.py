from typing import List, TypedDict

from src.models import NewsItem, Script


class AgentState(TypedDict):
    run_id: str
    bucket: str
    limit: int
    news: List[NewsItem]
    script: Script
    audio_paths: List[str]
    video_path: str
    status: str
    trend_mode: bool
    trend_data: dict
    director_data: dict
    knowledge_context: dict
