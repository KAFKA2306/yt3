from pathlib import Path

import yaml

ROOT = Path(__file__).parent.parent


def load_config() -> dict:
    path = ROOT / "config" / "default.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


def load_prompt(name: str) -> dict:
    path = ROOT / "prompts" / f"{name}.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


def get_speakers() -> dict[str, int]:
    cfg = load_config()
    return cfg.get("providers", {}).get("tts", {}).get("voicevox", {}).get("speakers", {})


def get_llm_model() -> str:
    cfg = load_config()
    return cfg.get("providers", {}).get("llm", {}).get("gemini", {}).get("model", "gemini-2.0-flash")
