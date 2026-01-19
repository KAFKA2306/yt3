import os

import yaml
from langchain_google_genai import ChatGoogleGenerativeAI

from src.asset import AssetStore
from src.config import ROOT, get_llm_model, load_prompt
from src.utils import parse_llm_json


class ResearchAgent:
    def __init__(self, store: AssetStore):
        self.store = store
        model = get_llm_model()
        self.llm = ChatGoogleGenerativeAI(
            model=model,
            api_key=os.getenv("GEMINI_API_KEY"),
            temperature=0.6,
        )
        self.kb_path = ROOT / "memory" / "knowledge_base.yaml"

    def load_kb(self) -> str:
        if not self.kb_path.exists():
            return "No past videos."
        with open(self.kb_path, "r") as f:
            data = yaml.safe_load(f)
        return yaml.dump(data)

    def run(self, category: str = "General") -> dict:
        self.store.log_input("research", {"category": category})

        kb = self.load_kb()
        prompt_cfg = load_prompt("research")
        system = prompt_cfg["system"].format(knowledge_base=kb)
        user = prompt_cfg["user_template"].format(category=category)

        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        res = self.llm.invoke(messages)

        self.store.save("research", "raw_response", {"content": res.content})

        parsed = parse_llm_json(str(res.content))
        if not isinstance(parsed, dict):
            parsed = {
                "topic": category,
                "angle": "STRUCTURAL",
                "title_hook": category,
                "search_query": category,
                "key_questions": [],
            }

        self.store.log_output("research", parsed)
        return parsed
