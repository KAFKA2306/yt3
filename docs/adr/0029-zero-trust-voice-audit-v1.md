# ADR 0029: Zero-Trust Voice Audit

## Status
Accepted

## Purpose
Keep voice routing, identity, and loudness stable across generated audio.

## Canonical Rules
1. Speaker-to-voice mapping must be explicit and stable.
2. Missing voice manifests block publish.
3. Acoustic collapse between different speakers is a failure.
4. Loudness must stay within the configured EBU R128 window.
5. Phonetic anchoring must come from the correction dictionary, not guesswork.

## Required Outputs
- `runs/<RUN_ID>/audit/voice_assignment_report.json`
- `runs/<RUN_ID>/audit/evidence_raw.json`
- `runs/<RUN_ID>/audio/manifest.json`
