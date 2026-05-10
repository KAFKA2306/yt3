# ADR-0006: Adopt 3-Layer Prompt Design for ASMR TTS

## Status

Accepted

## Context

ASMR quality tuning was unstable when prompt concerns were mixed in one text block.
Operational trials showed better reproducibility when separating control into:

1. speaker/body design
2. timeline/structure design
3. local micro-acting control

For Irodori-TTS VoiceDesign, this separation aligns with model behavior and improves iteration speed.

## Decision

Adopt a fixed 3-layer prompt architecture for ASMR generation:

1. `Caption` layer:
   - Define physical voice conditions (distance, breath amount, pacing, resonance, volume).
2. `Script` layer:
   - Define timeline transitions (normal distance -> near -> ear-side -> silence -> breath -> calm).
   - Explicitly design pauses/non-speaking segments.
3. `Emoji` layer:
   - Use emoji for local acting control (`👂`, `😮‍💨`, `⏸️`, `🤫`, etc.).

Also standardize operational defaults:

- Prefer `--no-ref` for baseline stability.
- Fix seed for reproducibility (`--seed 2306`).
- Keep iteration cost low with moderate steps (`--num-steps 8-12` unless quality requires higher).

## Consequences

- ASMR voice design becomes more reproducible and easier to debug.
- Team members can iterate each control layer independently.
- Documentation and templates now map directly to model control dimensions.
