from datetime import datetime

from pydantic import BaseModel, Field


class NewsItem(BaseModel):
    title: str
    summary: str
    url: str
    published_at: datetime = Field(default_factory=datetime.now)


class ScriptLine(BaseModel):
    speaker: str
    text: str
    duration: float = 0.0


class Script(BaseModel):
    title: str
    description: str
    lines: list[ScriptLine]
    total_duration: float = 0.0


class VideoMetadata(BaseModel):
    title: str
    description: str
    tags: list[str]
    thumbnail_path: str = ""
