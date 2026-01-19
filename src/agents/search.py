import os

from langchain_google_genai import ChatGoogleGenerativeAI

from src.asset import AssetStore
from src.config import load_prompt
from src.models import NewsItem
from src.utils import parse_llm_json


class WebSearchAgent:
    def __init__(self, store: AssetStore):
        self.store = store
        self.llm = ChatGoogleGenerativeAI(
            model="gemini-2.0-flash",
            api_key=os.getenv("GEMINI_API_KEY"),
            extra_body={"tools": [{"google_search": {}}]},
        )

    def run(self, query: str, count: int = 3) -> list[NewsItem]:
        self.store.log_input("search", {"query": query, "count": count})

        prompt_cfg = load_prompt("news")
        system = prompt_cfg["system"]
        user = prompt_cfg["user_template"].format(topic=query, count=count, recent_topics_note="なし")

        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        res = self.llm.invoke(messages)

        self.store.save("search", "raw_response", {"content": res.content})

        parsed = parse_llm_json(str(res.content))
        if not isinstance(parsed, list):
            parsed = []
        self.store.log_output("search", {"items": parsed})

        return [NewsItem(**i) for i in parsed]
