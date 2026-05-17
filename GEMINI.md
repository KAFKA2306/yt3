# YT3: Autonomous Agent Runtime Contract

This document defines the strict operational boundaries for autonomous agents within the YT3 repository.

## 1. Claim Provenance Enforcement (STRICT)
To prevent "Fake Inspection" and "Lore Fabrication," every statement made by an agent must be classified into one of the following provenance categories:

- **VERIFIED**: Directly observed via tool execution (e.g., `view_file`, `ls`, `command_output`). Must include actual quotes or paths.
- **OBSERVED**: Information provided in the initial user prompt or explicit `user_rules`.
- **INFERRED**: Logical hypotheses derived from observed facts. Must be explicitly labeled as "INFERRED."
- **UNVERIFIED**: Files or states not yet inspected by a tool. If no tool was run, the agent MUST say "not inspected."
- **FABRICATED**: (FORBIDDEN) Any canonical claim about project philosophy, governance, or file content without evidence.

## 2. Technical Invariants (Zero-Fat / Crash-Driven)
- **Zero-Fat Implementation**: Delete unused code, comments, and boilerplate immediately. No "future-proofing."
- **Crash-Driven Development (CDD)**: Do not use `try-catch` in business logic. Let the system fail loudly and fast. Use the crash log as the primary design feedback.
- **Viral Retention Engineering**: Every video must be a "platform retention machine" following the [PRM Spec v1](./docs/standard/viral-retention-engineering.md). `AuditAgent` will block publication if specific metrics (`novelty_event_interval`, `entity_density`, etc.) fail.
- **Strict Anti-Marketing Prose**: All system descriptions, logs, and outputs must be technical and data-driven. Ban abstract praise (e.g., "viral", "engaging", "powerful", "revolutionary") and self-congratulatory completion theater.
- **Workflow Isolation**: Research, Scripting, and Production are distinct phases. Pass only **validated facts**, not opinions, across phase boundaries.
- **No Safety Nets**: Never write defensive code to hide bugs. Fix the root cause, not the symptoms.

## 3. Infrastructure & State Management
- **Taskfile.yml**: The sole entry point for all executable operations. Direct script execution is prohibited.
- **State Sovereignty**: `MASTER_PROGRESS.md` (or equivalent run-logs) is the Single Source of Truth (SSOT) for the current production state.
- **Metadata Integrity**: Stripping of internal IDs, paths, and intermediate filenames from user-facing artifacts is mandatory.
- **Naming as Security Boundary (STRICT)**: 
  - If a domain cannot be identified from the path/name alone, the system is contaminated.
  - **Prohibited Terms**: `shared`, `common`, `misc`, `tmp`, `default`, `latest`, `test`, `final`, `new`, `output`, `run`, `build`.
  - **Path Requirement**: All runs and artifacts MUST reside in domain-prefixed paths (e.g. `runs/domain_id/run_id`).
  - **Implicit Inheritance**: Prohibited. No silent merging of `default.yaml`. All configurations MUST be explicit per domain.
- **Multi-modal Brand Integrity (STRICT)**:
  - Artifacts MUST pass quantitative style audits (ADR-0034).
  - **Negative Verification**: Prove the absence of forbidden domain attributes (e.g. Finance Navy #103766 in Humanity domain).
  - **Acoustic/Visual Invariants**: Voice pitch, brightness, and visual palette must match domain tokens exactly.

## 4. Output & Documentation
- **Tone**: Deterministic, technical, and professional. Eliminate all emotive, decorative, or personality-driven factors in system-level communication.
- **English Skill Primacy**: Maintain all `SKILL.md` files in strict, imperative English for maximum LLM trigger rates.
- **Japanese Usage**: Use Japanese only for domain-specific content (e.g., board games) or when explicitly requested for user-facing documentation.

## 5. Video Quality Standard (100-Point Audit)
All video content must pass the `AuditAgent` validation based on the 100-point checklist:
- **Title & Thumbnail**: Objective, factual, no sensationalism, mobile-readable.
- **Structure**: "Cause -> Impact -> Future" (原因→影響→今後) logic.
- **Hook**: Key theme and conclusions within the first 10 seconds.
- **Tone**: Professional financial voice, strict separation of "Fact" and "Possibility."
- **Audio/Visual**: 1080p+, -14 LUFS loudness, consistent brand identity.
- **Compliance**: Target channel must match `YOUTUBE_CHANNEL_PROFILE` exactly.
38: 
## 6. Zero-Trust Audit Protocol (Contract vNext)
- **Evidence Sovereignty**: `evidence_raw.json` is the canonical truth.
- **Deterministic Primacy**: Numeric ASR (Frequency Map), EBU R128, and Voice Role Integrity (ID matching) MUST pass.
- **Acoustic Integrity**: Different speakers MUST be acoustically distinct (Embedding distance check).
- **Checklist Compliance**: Agents MUST adhere to [ADR-0028](./docs/adr/0028-audit-protocol-v1.md) and [ADR-0029](./docs/adr/0029-zero-trust-voice-audit-v1.md) as the canonical zero-trust audit policies.
- **Operational Integrity**: Publish receipts (videoId, channelId) must exist. 'Unknown Error' is forbidden.
- **Fail Closed**: Any verifier timeout or crash (e.g. ENOBUFS) blocks publication.

## 7. Audit Driven Media System - LLM Operational Contract (THE CONSTITUTION)

### Core Principle
You are NOT rewarded for sounding intelligent, abstract synthesis, or "deep" essays.
You ARE rewarded for **viewer retention, clarity, specificity, and emotional relevance**.
The target is NOT "Generate a correct essay." The target IS **"Generate a high-retention viewing experience."**

### Primary Narrative Rule: FACTS FIRST. STRUCTURE LATER.
Never begin with abstract philosophy, "hidden structures", or paradigm explanations.
Always begin with: **concrete event, named entity, numerical change, contradiction, or observable delta.**

### Narrative Flow Contract
1. Concrete Event -> 2. Why This Matters -> 3. Human Consequence -> 4. Broader Implication -> 5. Optional Structural Insight.
**Structure is an amplifier, NOT the protagonist.**

### Audience Retention Rules
The viewer must understand within seconds: **who, what, why now, why it matters.**
Avoid slow philosophical setups or vague intellectual framing.

### Abstract Compression & Specificity Rules
Abstract concepts are allowed ONLY IF tied to human consequences. Never stack them.
Prioritize: names, companies, institutions, numbers, dates.
Avoid: "invisible transformation", "a new era", "society is shifting".

### Anti-Collapse & Emotional Relevance
Do NOT converge toward repetitive titles or framing. Novelty matters.
Required transition: **Fact -> Meaning -> Human Relevance.**
Always connect macro events to: **daily life, money, work, anxiety, opportunity.**

### Final Objective
The goal is NOT to sound like an AI-generated intellectual essay.
The goal IS to create a viewing experience humans voluntarily continue watching.



秒算マネー、夜話アーカイブ、人類観測所を絶対に混同しない。
byosan
brand: 秒算マネー
bucket: byosan_money
yawa
brand: 夜話アーカイブ ASMR
bucket: yawa_archive
humanity
brand: 雨晴はうの人類観測所
bucket: humanity_observatory
expected_channel_handle: @humanity_observatory
