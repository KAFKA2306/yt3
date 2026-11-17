"""Synthesize an episode with one Irodori runtime and reject truncated inputs."""

import argparse
import json
import sys
from pathlib import Path

from irodori_tts.inference_runtime import (
    InferenceRuntime,
    RuntimeKey,
    SamplingRequest,
    download_hf_checkpoint,
    save_wav,
)
from irodori_tts.text_normalization import normalize_text


def check_input(runtime, request, label):
    if request.seconds is not None and not request.min_seconds <= request.seconds <= request.max_seconds:
        raise ValueError(f"{label}: duration must be between {request.min_seconds} and {request.max_seconds} seconds")
    text = normalize_text(request.text).strip()
    if not text:
        raise ValueError(f"{label}: text became empty after normalization")
    lengths = [
        ("text", runtime.tokenizer.encode(text).numel(), runtime.default_text_max_len),
    ]
    if request.caption:
        if runtime.caption_tokenizer is None:
            raise ValueError(f"{label}: checkpoint does not accept voice captions")
        lengths.append(
            (
                "caption",
                runtime.caption_tokenizer.encode(request.caption.strip()).numel(),
                runtime.default_caption_max_len,
            )
        )
    for name, count, limit in lengths:
        if count > limit:
            raise ValueError(f"{label}: {name} has {count} tokens; checkpoint limit is {limit}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("checkpoint")
    parser.add_argument("device")
    parser.add_argument("precision")
    args = parser.parse_args()
    plan = json.load(sys.stdin)
    checkpoint = (
        str(Path(args.checkpoint).resolve())
        if Path(args.checkpoint).is_file()
        else download_hf_checkpoint(args.checkpoint)
    )
    runtime = InferenceRuntime.from_key(
        RuntimeKey(
            checkpoint=checkpoint,
            model_device=args.device,
            model_precision=args.precision,
            codec_device=args.device,
        )
    )
    requests = []
    for item in plan:
        output = Path(item["output"])
        request = SamplingRequest(**item["request"])
        check_input(runtime, request, output.name)
        requests.append((output, request))
    for output, request in requests:
        print(f"[yawa] synthesizing {output.name}", flush=True)
        result = runtime.synthesize(request)
        save_wav(output, result.audio, result.sample_rate)


if __name__ == "__main__":
    main()
