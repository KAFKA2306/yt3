"""Transcribe a yawa audio file and print the text as JSON (reverse transcription QA)."""

import json
import sys

from faster_whisper import WhisperModel


def main() -> None:
    audio, model_name = sys.argv[1], sys.argv[2]
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, _ = model.transcribe(audio, language="ja", vad_filter=True)
    print(json.dumps({"text": "".join(s.text for s in segments)}, ensure_ascii=False))


main()
