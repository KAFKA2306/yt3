#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input-wav", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--model", default="small")
    args = ap.parse_args()

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    from faster_whisper import WhisperModel

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        args.input_wav,
        language="ja",
        vad_filter=True,
        beam_size=5,
        condition_on_previous_text=False,
        vad_parameters={"min_silence_duration_ms": 400},
    )

    txt_lines = []
    jsonl_lines = []
    count = 0
    for s in segments:
        text = s.text.strip()
        txt_lines.append(f"[{s.start:8.2f}-{s.end:8.2f}] {text}")
        jsonl_lines.append(
            json.dumps(
                {
                    "start": s.start,
                    "end": s.end,
                    "text": text,
                },
                ensure_ascii=False,
            )
        )
        count += 1

    (out_dir / "asr_raw.txt").write_text("\n".join(txt_lines) + "\n", encoding="utf-8")
    (out_dir / "asr_raw.jsonl").write_text("\n".join(jsonl_lines) + "\n", encoding="utf-8")
    (out_dir / "asr_meta.json").write_text(
        json.dumps(
            {
                "language": info.language,
                "language_probability": info.language_probability,
                "segments": count,
                "model": args.model,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(str(out_dir))


if __name__ == "__main__":
    main()
