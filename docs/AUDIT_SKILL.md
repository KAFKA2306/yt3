# YT3: Zero-Trust Audit Skill

## Objective
Enforce the "Viewer-Centric Quality Contract" via deterministic physical verification and bounded semantic evaluation. 

## Hard Constraints
- NEVER trust LLM summaries as ground truth.
- ALWAYS extract raw physical evidence (FFmpeg, ASR, OCR).
- SEPARATE Deterministic Verifiers from Probabilistic Evaluators.
- BLOCK PUBLISH if any CRITICAL deterministic verifier fails.
- FAIL CLOSED: If a verifier (e.g. Whisper) fails to run, the target is considered UNVERIFIED and BLOCKED.

## Verifier Patterns

### 1. Audio Integrity (EBU R128)
- TOOL: `ffmpeg -af ebur128=peak=true`
- METRIC: Integrated LUFS (-14 target) and True Peak (<-1.0).
- FAIL: Outside range [-18, -11] or Peak > -0.1.

### 2. Video Signal (Freeze/Black)
- TOOL: `ffmpeg -vf "freezedetect=d=5,blackdetect=d=2"`
- FAIL: Any detection of frozen or black segments.

### 3. ASR Loopback (Numeric Drift)
- TOOL: `run_asr.py` (faster-whisper)
- LOGIC: Extract numeric frequency map from script vs transcript.
- FAIL: Any count mismatch or missing numbers (exact match). No substring matching.

### 4. Semantic Alignment
- TOOL: LLM with temperature 0.
- RUBRIC: "Cause -> Impact -> Future" structure and "Adaptive Growth" tone.
- TYPE: PROBABILISTIC (Non-blocking unless extreme).

## Artifact Sovereignty
- Canonical Source: `evidence_raw.json`
- Metadata: `provenance.json` (Commit, Run, Env)
- Report: `audit_report.md` (Summary only)
