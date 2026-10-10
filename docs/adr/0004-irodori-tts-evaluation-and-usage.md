# ADR-0004: Irodori-TTS Evaluation and Usage Baseline

## Status

Accepted (updated: v4.1 only)

## Context

We needed a reproducible local TTS path for yt3 script read-throughs without impacting existing `src/` behavior.
Initial verification showed:

1. `Irodori-TTS` was not previously integrated in the repository.
2. Sandbox/runtime constraints existed for port binding and intermittent DNS resolution to Hugging Face.
3. Reference-audio quality strongly affected output naturalness; synthetic sine-wave reference produced unnatural voice quality.

## Decision

1. Install and run Irodori-TTS v4.1 in `sandbox/Irodori-TTS-v4.1` (not in `src/`) using `uv sync --extra cu128`.
2. Use `UV_CACHE_DIR=.uv-cache` for runtime commands in this environment to avoid global uv cache permission failures.
3. Use `Aratako/Irodori-TTS-v4.1-Small` as the only checkpoint. Older versions (v2, v2-VoiceDesign, v3) are removed and must not be reintroduced alongside it.
4. Establish `--no-ref` as the baseline path for script preview and production generation.
5. Use `--caption` for persona/tone control. The v4.1-Small checkpoint supports caption conditioning.
6. Extract subtitle dialogue into a dedicated text artifact before synthesis:
   - `/home/kafka/2511youtuber/v3/yt3/runs/2026-05-09/script_for_tts.txt`

## Consequences

- We now have a reproducible TTS preview flow that works in sandboxed operations.
- Output quality checks start from deterministic seed + `--no-ref`. Reference-audio paths are not verified for v4.1 yet.
- Smoke verification: `infer.py --hf-checkpoint Aratako/Irodori-TTS-v4.1-Small --no-ref` runs on CUDA and writes a WAV.
- Gradio UI verification may still require running on the user host due to sandbox port/network limitations.
