import os

from langchain_google_genai import ChatGoogleGenerativeAI

from src.asset import AssetStore
from src.config import get_llm_model, load_prompt
from src.utils import parse_llm_json


class DirectorAgent:
    def __init__(self, store: AssetStore):
        self.store = store
        model = get_llm_model()
        self.llm = ChatGoogleGenerativeAI(
            model=model,
            api_key=os.getenv("GEMINI_API_KEY"),
            temperature=0.4,  # Lower temp for consistent strategy
        )

    def run(self, trend_data: dict) -> dict:
        self.store.log_input("director", trend_data)

        prompt_cfg = load_prompt("director")
        system = prompt_cfg["system"]
        user = prompt_cfg["user_template"].format(
            topic=trend_data.get("topic", "Unknown"),
            search_query=trend_data.get("search_query", ""),
            reason=trend_data.get("reason", ""),
        )

        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        res = self.llm.invoke(messages)

        self.store.save("director", "raw_response", {"content": res.content})

        parsed = parse_llm_json(str(res.content))
        if not isinstance(parsed, dict):
            parsed = {
                "angle": "Standard Analysis",
                "rationale": "Fallback due to parsing error",
                "key_questions": ["What is happening?", "Why is it important?"],
                "target_tone": "Neutral",
                "search_keywords": [],
            }

        self.store.log_output("director", parsed)
        return parsed
