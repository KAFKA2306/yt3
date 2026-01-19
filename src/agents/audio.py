from io import BytesIO

import requests
from pydub import AudioSegment  # type: ignore

from src.asset import AssetStore
from src.config import get_speakers, load_config
from src.models import Script


class AudioAgent:
    def __init__(self, store: AssetStore):
        self.store = store
        cfg = load_config()
        self.base_url = cfg["providers"]["tts"]["voicevox"]["url"]
        self.speakers = get_speakers()

    def run(self, script: Script) -> list[str]:
        self.store.log_input("audio", script.model_dump())

        audio_dir = self.store.audio_dir()
        audio_paths = []
        combined = AudioSegment.empty()

        for i, line in enumerate(script.lines):
            spk_id = self.speakers.get(line.speaker, 1)
            text = line.text

            q = requests.post(f"{self.base_url}/audio_query", params={"text": text, "speaker": spk_id})  # type: ignore
            q.raise_for_status()
            q_data = q.json()

            s = requests.post(f"{self.base_url}/synthesis", params={"speaker": spk_id}, json=q_data)  # type: ignore
            s.raise_for_status()

            chunk = AudioSegment.from_file(BytesIO(s.content), format="wav")
            combined += chunk

            path = audio_dir / f"{i:03d}_{line.speaker}.wav"
            chunk.export(str(path), format="wav")
            audio_paths.append(str(path))

        full_path = audio_dir / "full_audio.wav"
        combined.export(str(full_path), format="wav")

        self.store.log_output("audio", {"paths": audio_paths, "full": str(full_path)})

        return audio_paths
