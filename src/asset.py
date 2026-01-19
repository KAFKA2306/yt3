from pathlib import Path

import yaml

from src.config import ROOT


class AssetStore:
    def __init__(self, run_id: str):
        self.run_dir = ROOT / "runs" / run_id
        self.run_dir.mkdir(parents=True, exist_ok=True)

    def save(self, stage: str, name: str, data: dict | list) -> Path:
        stage_dir = self.run_dir / stage
        stage_dir.mkdir(exist_ok=True)
        path = stage_dir / f"{name}.yaml"
        with open(path, "w") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False)
        return path

    def load(self, stage: str, name: str) -> dict | list:
        path = self.run_dir / stage / f"{name}.yaml"
        with open(path) as f:
            return yaml.safe_load(f)

    def save_binary(self, stage: str, name: str, data: bytes) -> Path:
        stage_dir = self.run_dir / stage
        stage_dir.mkdir(exist_ok=True)
        path = stage_dir / name
        with open(path, "wb") as f:
            f.write(data)
        return path

    def log_input(self, stage: str, data: dict) -> None:
        self.save(stage, "input", data)

    def log_output(self, stage: str, data: dict) -> None:
        self.save(stage, "output", data)

    def audio_dir(self) -> Path:
        d = self.run_dir / "audio"
        d.mkdir(exist_ok=True)
        return d

    def video_dir(self) -> Path:
        d = self.run_dir / "video"
        d.mkdir(exist_ok=True)
        return d
