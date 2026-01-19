import os

import yaml
from langchain_google_genai import ChatGoogleGenerativeAI

from src.asset import AssetStore
from src.config import ROOT, get_llm_model, load_prompt
from src.utils import parse_llm_json


class KnowledgeAgent:
    def __init__(self, store: AssetStore):
        self.store = store
        model = get_llm_model()
        self.llm = ChatGoogleGenerativeAI(
            model=model,
            api_key=os.getenv("GEMINI_API_KEY"),
            temperature=0.2,  # Low temp for factual retrieval
        )
        self.kb_path = ROOT / "memory" / "knowledge_base.yaml"

    def load_kb(self) -> str:
        if not self.kb_path.exists():
            return "No knowledge base found."
        with open(self.kb_path, "r") as f:
            data = yaml.safe_load(f)
        return yaml.dump(data)

    def run(self, trend_data: dict, director_data: dict) -> dict:
        self.store.log_input("knowledge", {"trend": trend_data, "director": director_data})

        usage_kb = self.load_kb()
        prompt_cfg = load_prompt("knowledge")

        system = prompt_cfg["system"].format(
            knowledge_base=usage_kb,
            topic=trend_data.get("topic"),
            angle=director_data.get("angle"),
            questions=director_data.get("key_questions"),
        )
        user = prompt_cfg["user_template"]

        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        res = self.llm.invoke(messages)

        self.store.save("knowledge", "raw_response", {"content": res.content})

        parsed = parse_llm_json(str(res.content))
        if not isinstance(parsed, dict):
            parsed = {"past_references": [], "deep_search_queries": director_data.get("key_questions", [])}

        self.store.log_output("knowledge", parsed)
        return parsed
