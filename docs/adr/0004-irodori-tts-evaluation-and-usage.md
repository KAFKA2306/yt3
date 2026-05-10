# ADR-0004: Irodori-TTS Evaluation and Usage Baseline

## Status

Accepted

## Context

We needed a reproducible local TTS path for yt3 script read-throughs without impacting existing `src/` behavior.
Initial verification showed:

1. `Irodori-TTS` was not previously integrated in the repository.
2. Sandbox/runtime constraints existed for port binding and intermittent DNS resolution to Hugging Face.
3. Reference-audio quality strongly affected output naturalness; synthetic sine-wave reference produced unnatural voice quality.

## Decision

1. Install and run Irodori-TTS in `sandbox/Irodori-TTS` (not in `src/`) using `uv sync`.
2. Use `UV_CACHE_DIR=.uv-cache` for runtime commands in this environment to avoid global uv cache permission failures.
3. Establish `--no-ref` as the baseline validation path for script preview generation.
4. Keep VoiceDesign as the preferred style-control path via `--caption` for persona/tone design without reference audio.
5. Extract subtitle dialogue into a dedicated text artifact before synthesis:
   - `/home/kafka/2511youtuber/v3/yt3/runs/2026-05-09/script_for_tts.txt`

## Consequences

- We now have a reproducible TTS preview flow that works in sandboxed operations.
- Output quality checks can start from deterministic seed + `--no-ref`, then expand to human reference voice tests.
- VoiceDesign generation is available and validated in this workspace (`outputs/kafka_voice.wav`).
- Gradio UI verification may still require running on the user host due to sandbox port/network limitations.
