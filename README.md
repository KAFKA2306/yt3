# YT3: Autonomous Resonance Production Pipeline

A high-fidelity, autonomous media generation system integrating LangGraph.js, Gemini, Voicevox, and FFmpeg. Designed for deterministic execution and self-healing.

## 1. System Overview
YT3 is an end-to-end pipeline that scans raw data (Daily Pulse), synthesizes long-form scripts (Resonance Runtime), and produces verified media assets.

### Key Workflows
- **Autonomous Production**: Triggered via `task run`. Handles research, scripting, and media synthesis.
- **Sentinel Monitoring**: Daily success detection and failure auditing (see `.github/workflows/`).
- **Auto-Healing**: Autonomous root-cause analysis and localized patching upon workflow failure.

## 2. Technical Stack
- **Engine**: Gemini 3 Flash (Primary)
- **Runtime**: Bun (TypeScript) / uv (Python)
- **Audio**: Irodori-TTS / Voicevox
- **Video**: FFmpeg
- **Orchestration**: Taskfile.yml

## 3. Atomic Operations (Taskfile)
| Command              | Description                                 |
| :------------------- | :------------------------------------------ |
| `task bootstrap`     | Environment and dependency setup.           |
| `task run`           | Start the autonomous production loop.       |
| `task asmr:expand`   | Physical script expansion (5,000+ chars).   |
| `task asmr:reliable` | Synthesis with mandatory ASR verification.  |
| `task lint`          | Structural and type integrity verification. |
| `task up`            | Start backend synthesis services.           |

## 4. Stability & Safety
- **Crash-Driven Development**: Failures are treated as feedback. No silent errors or defensive handling.
- **Zero-Trust Verification**: All media assets must pass **Closed-Loop ASR** and metadata auditing before publishing.
- **Resource Protection**: OAuth-based subscription usage (No direct API key leakage).

## 5. Directory Map
- `src/agents/`: Logic and tool definitions for autonomous actors.
- `config/`: Centralized YAML configuration.
- `.claude/skills/`: Strict English-language skill protocols.
- `docs/adr/`: Record of architectural decisions and invariants.
- `runs/`: Structured logs, artifacts, and MASTER_PROGRESS status.




LLM向けに本当に重要なのは、「何を見るか」だけではなく、

* 何を CLAIM してよいか
* 何を CLAIM してはいけないか
* 何が PASS 条件か
* verifier failure をどう扱うか
* evidence をどこに保存するか

まで contract 化することです。

なので完全版は、

* 原則
* 実行規約
* verifier taxonomy
* blocker policy
* evidence policy
* replay policy
* viewer quality policy

まで含める必要があります。

---

# YT3 / 秒算マネー

# LLM Audit Contract vNext

# Zero-Trust Viewer Quality Protocol

## 0. Core Principle

監査の目的は：

* 「動画が存在する」ことではない
* 「壊れていない」ことでもない
* 「視聴者が金融情報を安全・正確・快適に受け取れる」ことを保証することである

LLMは：

* reviewer
  ではなく、
* verifier first

として振る舞う。

---

# 1. Hard Rules

## MUST

* MUST separate OBSERVED vs INFERRED vs ASSUMED
* MUST save raw evidence
* MUST preserve deterministic replayability
* MUST block publish on critical verifier failure
* MUST classify verifier type
* MUST preserve provenance
* MUST preserve audit trace
* MUST fail closed
* MUST prefer evidence over explanation
* MUST output machine-readable artifacts

## MUST NOT

* MUST NOT hallucinate evidence
* MUST NOT claim verification without raw evidence
* MUST NOT mark PASS from subjective impression alone
* MUST NOT silently fallback
* MUST NOT ignore verifier failure
* MUST NOT publish on unresolved critical audit
* MUST NOT overwrite canonical evidence
* MUST NOT treat reviewer score as deterministic truth

---

# 2. Verifier Taxonomy

## DETERMINISTIC

Physical / mathematical / replayable.

Examples:

* bitrate
* LUFS
* WER
* blackdetect
* freezedetect
* OCR diff
* subtitle timing
* file hash
* API response
* upload confirmation
* env isolation

Rules:

* MUST produce reproducible PASS/FAIL
* MUST output raw evidence
* MUST define thresholds
* MUST define failure policy

## PROBABILISTIC

Reviewer-style evaluation.

Examples:

* retention impression
* emotional fatigue
* brand resonance
* pacing quality
* hook strength
* narrative coherence

Rules:

* MUST NEVER be sole blocker
* MUST be non-canonical
* MUST preserve prompt provenance
* MUST preserve model version
* MUST preserve raw response

---

# 3. Evidence Sovereignty

## Canonical Source

The canonical source is NOT:

* markdown report
* LLM summary
* explanation

The canonical source IS:

* raw ffmpeg output
* raw ASR output
* raw OCR
* raw metrics JSON
* raw verifier outputs
* raw upload response
* hashes
* traces

## Required Files

* evidence_raw.json
* verifier_results.json
* provenance.json
* replay_manifest.json
* upload_receipt.json
* ffmpeg_raw.log
* asr_raw.jsonl
* ocr_raw.json
* subtitle_alignment.json

---

# 4. Provenance Requirements

Every audit MUST preserve:

* git commit hash
* workflow version
* ffmpeg version
* whisper version
* TTS model hash
* runtime architecture
* GPU info
* execution timestamp
* prompt hash
* environment profile
* upload target identity

---

# 5. Audio Quality Audit

## Required Verifiers

### Loudness

* EBU R128
* Integrated LUFS
* True Peak

PASS:

* LUFS between -18 and -11
* Peak below -0.1 dBTP

### Speech Intelligibility

* consonant clarity
* speech/music masking
* dynamic range

### Silence

FAIL if:

* silence > threshold
* unintended mute segment detected

### Clipping

FAIL if:

* clipping frames detected

### TTS Integrity

FAIL if:

* hallucinated words
* truncated speech
* pronunciation collapse
* language collapse
* numeric misread

---

# 6. ASR Loopback Audit

## Goal

Verify semantic integrity.

Pipeline:

TTS output
→ ASR reverse transcription
→ normalization
→ diff
→ semantic verifier

## MUST detect

* numeric drift
* ticker mismatch
* percentage mismatch
* omitted sentence
* hallucinated phrase

## MUST NOT use naive substring matching

Forbidden:

* transcript.includes()

Required:

* token alignment
* normalized numeric extraction
* semantic entity comparison
* WER/CER

---

# 7. Subtitle Audit

## Required

* subtitle/audio alignment
* timing overlap check
* overflow detection
* mobile readability
* safe-area compliance

FAIL if:

* subtitle desync
* unreadable font size
* text cutoff
* overlap collapse

---

# 8. Video Signal Audit

## Required

* blackdetect
* freezedetect
* duplicate frame detection
* scene pacing analysis
* encoder corruption detection

## MUST distinguish

* intentional static graph
  vs
* broken freeze

---

# 9. Viewer Experience Audit

## Required Questions

* Is the topic understandable within 10 seconds?
* Is there a clear hook?
* Is the narrative:
  Cause → Impact → Future
* Is the pacing exhausting?
* Is the information density survivable?
* Is there viewer value?
* Is the video actionable?
* Is fear amplification excessive?

---

# 10. Financial Integrity Audit

## MUST detect

* unsupported claims
* fabricated statistics
* outdated data
* source omission
* false certainty
* ticker confusion
* percentage drift

## MUST separate

* FACT
* FORECAST
* POSSIBILITY
* OPINION

---

# 11. Brand Integrity Audit

## MUST verify

* channel identity
* tone consistency
* thumbnail identity
* narration identity
* CTA consistency
* continuity with previous uploads

FAIL if:

* sensationalist drift
* fearbait
* clickbait mismatch
* identity collapse

---

# 12. Upload Safety

## MUST verify

* channel profile isolation
* expected channel title
* upload target
* privacy mode
* upload success receipt

FAIL if:

* wrong channel
* missing profile
* upload ambiguity

---

# 13. Replayability

Every audit MUST be replayable.

Replay requires:

* same inputs
* same prompts
* same verifier config
* same models
* same thresholds

Replay MUST reconstruct:

* PASS/FAIL
* evidence bundle
* upload decision

---

# 14. Failure Policy

## HARD FAIL

Block publish immediately.

Examples:

* ASR semantic drift
* black frames
* corrupted audio
* wrong upload target
* hallucinated financial numbers
* provenance missing

## WARN

Publish allowed with review.

Examples:

* pacing concerns
* weak hook
* moderate retention risk

---

# 15. Verifier Failure Policy

Critical distinction:

* target failure
  vs
* verifier failure

Example:

* Whisper timeout
  ≠
* audio integrity PASS

Verifier unavailable:

* MUST emit explicit verifier_unavailable
* MUST define escalation policy

---

# 16. Forbidden Claims

LLM MUST NOT say:

* “quality guaranteed”
* “fully verified”
* “safe to publish”

unless ALL critical deterministic verifiers PASS.

---

# 17. Final Publish Contract

Publish allowed ONLY if:

* all HARD deterministic verifiers PASS
* provenance complete
* evidence bundle complete
* upload target verified
* no unresolved verifier failure
* replay manifest generated

Otherwise:

PUBLISH BLOCKED.
