import json

import yaml


def clean_code_block(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if len(lines) > 1:
            text = "\n".join(lines[1:])
        text = text.rsplit("```", 1)[0]
    return text.strip()


def parse_llm_json(text: str) -> dict | list:
    return json.loads(clean_code_block(text))


def parse_llm_yaml(text: str) -> dict | list:
    return yaml.safe_load(clean_code_block(text))
