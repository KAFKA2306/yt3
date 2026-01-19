import os

from langchain_google_genai import ChatGoogleGenerativeAI

from src.asset import AssetStore
from src.config import get_llm_model, load_prompt
from src.utils import parse_llm_json


class TrendAgent:
    def __init__(self, store: AssetStore):
        self.store = store
        model = get_llm_model()
        self.llm = ChatGoogleGenerativeAI(
            model=model,
            api_key=os.getenv("GEMINI_API_KEY"),
            temperature=0.7,  # Higher temperature for creativity/trends
        )

    def run(self, category: str = "General", region: str = "JP") -> dict:
        self.store.log_input("trend", {"category": category, "region": region})

        prompt_cfg = load_prompt("trend")
        system = prompt_cfg["system"]
        user = prompt_cfg["user_template"].format(category=category, region=region)

        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]

        # In a real scenario, we might want to inject actual Google Trends data here
        # For now, we rely on the LLM's internal knowledge or we could add a search tool step before this.
        # To make it "Destructive" and powerful, let's assume the LLM acts as the filter
        # for a preliminary search if we had one.
        # For this step, we just ask the LLM to hallucinate/retrieve "current" trends
        # (knowing Gemini 2.0 has good grounding).

        res = self.llm.invoke(messages)

        self.store.save("trend", "raw_response", {"content": res.content})

        parsed = parse_llm_json(str(res.content))
        if not isinstance(parsed, list):
            parsed = []

        # Sort by hypeness
        parsed.sort(key=lambda x: x.get("hypeness_score", 0), reverse=True)

        best_trend = parsed[0] if parsed else {"topic": category, "search_query": category}

        self.store.log_output("trend", {"all_trends": parsed, "selected": best_trend})

        return best_trend
