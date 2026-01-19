import os

from langchain_google_genai import ChatGoogleGenerativeAI

from src.asset import AssetStore
from src.config import get_llm_model, load_prompt
from src.models import NewsItem, Script, ScriptLine
from src.utils import parse_llm_yaml


class ScriptAgent:
    def __init__(self, store: AssetStore):
        self.store = store
        model = get_llm_model()
        self.llm = ChatGoogleGenerativeAI(model=model, api_key=os.getenv("GEMINI_API_KEY"), temperature=0.8)

    def run(self, news: list[NewsItem], director_data: dict = {}, knowledge_context: dict = {}) -> Script:
        prompt_cfg = load_prompt("script")

        self.store.log_input(
            "script",
            {"news": [n.model_dump() for n in news], "director": director_data, "knowledge": knowledge_context},
        )

        system = prompt_cfg["system"]
        # Format user template with RAG context
        base_prompt = prompt_cfg["user_template"]

        # We need to inject the extra context into the prompt
        # Assuming the prompt has placeholders or we append it
        strategy_str = (
            f"Strategy/Angle: {director_data.get('angle', 'Default')}\n"
            f"Key Questions: {director_data.get('key_questions', [])}"
        )
        context_str = f"Past References: {knowledge_context.get('past_references', [])}"

        user = (
            base_prompt.format(news_items=news)
            + f"\n\n[STRATEGIC INSTRUCTION]\n{strategy_str}"
            + f"\n\n[KNOWLEDGE CONTEXT]\n{context_str}"
        )

        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        res = self.llm.invoke(messages)

        self.store.save("script", "raw_response", {"content": res.content})

        data = parse_llm_yaml(str(res.content))
        if not isinstance(data, dict):
            data = {}

        lines = [ScriptLine(speaker=seg["speaker"], text=seg["text"], duration=0.0) for seg in data.get("segments", [])]

        script = Script(title=str(news[0].title if news else "News"), description="", lines=lines)
        self.store.log_output("script", script.model_dump())

        return script
