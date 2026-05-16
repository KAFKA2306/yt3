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
- **Workflow Isolation**: Research, Scripting, and Production are distinct phases. Pass only **validated facts**, not opinions, across phase boundaries.
- **No Safety Nets**: Never write defensive code to hide bugs. Fix the root cause, not the symptoms.

## 3. Infrastructure & State Management
- **Taskfile.yml**: The sole entry point for all executable operations. Direct script execution is prohibited.
- **State Sovereignty**: `MASTER_PROGRESS.md` (or equivalent run-logs) is the Single Source of Truth (SSOT) for the current production state.
- **Metadata Integrity**: Stripping of internal IDs, paths, and intermediate filenames from user-facing artifacts is mandatory.

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

