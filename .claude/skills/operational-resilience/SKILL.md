---
name: operational-resilience
description: Core infrastructure standards for the YT3 project. Apply when making architectural decisions, reviewing system design, handling failures, or setting up LLM orchestration strategy. Triggers on "infrastructure", "system design", "fail fast", "retry", "path management", "service unit", or when checking if a design follows project Iron Rules.
---

# Operational Resilience

## Why These Rules Exist

Silent failures are harder to fix than loud ones. Every rule here is designed to make problems visible immediately — not to prevent crashes, but to make crashes diagnostic.

## LLM Strategy

Use Gemini Flash exclusively for multi-source processing — its context window allows simultaneous ingestion of multiple feeds without pagination. For quota management and key rotation, delegate to `llm-quota-orchestration`.

All structured outputs use `responseMimeType: "application/json"`. Parsing is handled in `src/io/core.ts` — do not reinvent JSON extraction.

## Workflow Control

Compress context between stages. Never pass full chat history forward — extract `summary` or `essence` before the next step. This prevents context bloat that degrades output quality in later stages.

Checkpoints must be idempotent. Any operation with side effects (file writes, API calls, publishes) should be safe to rerun from the last checkpoint without duplicating output.

## Failure Handling

No `try-catch` in business logic. Unexpected states should crash immediately with a full stack trace — the infrastructure (Systemd `Restart=`) handles recovery. Application-level retries mask quota exhaustion and make diagnosis exponentially harder.

## Infrastructure Essentials

- **Absolute paths**: All scripts and service units use absolute paths. Relative paths break when working directory changes.
- **Service unit standards**: Every unit defines `User`, `Group`, and `WorkingDirectory`. Use `ExecStartPre=+/bin/chown` to fix permissions before privilege drop.
- **Pre-flight**: Verify write access to `runs/` and `logs/` before initialization.

## Delivery Transparency

Every successful publish workflow concludes with explicit **Final Deliverable Metadata**:
- Video title: from `{runDir}/content/output.yaml`
- Public URL/ID: from `{runDir}/publish/output.yaml`

This closes the feedback loop — the agent confirms what was actually published, not what was intended.

## Content Standards

Ground all analysis in verifiable hard data. Avoid "Systemic Collapse" framing — focus on structural adaptive strategies that empower rather than alarm.
