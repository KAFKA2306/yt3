---
name: operational-resilience
description: Guarantees stable system operation, efficient resource consumption, and strict adherence to the project's "Iron Rules" using LangGraph and Gemini 3 Flash.
---

# Operational Resilience (Core Infrastructure)

**Objective**: Ensure high availability and rigorous execution standards by leveraging the full capabilities of the Gemini 3 Flash model and maintaining a robust workflow architecture.

## 1. LLM Operations (Gemini Strategy)
*   **Gemini 3 Flash Exclusive**: Prohibition of model switching. Explosive context window utilization is mandatory for processing vast T1/T2 information sources simultaneously.
*   **Prompt Caching**: Strategically place system instructions and knowledge bases at the prefix to maximize implicit caching, drastically reducing latency and operational costs.
*   **JSON Enforcement**: All structured outputs must use `responseMimeType: "application/json"`. Verify parsing via `src/io/core.ts` to prevent runtime failures.

## 2. Workflow Control (LangGraph Strategy)
*   **State Minimization**: Do not persist full chat histories. Compress context into `summary` or `essence` before relaying to the next node.
*   **Safe Resume Logic**: Maintain deterministic checkpoints. All operations with side effects MUST be idempotent to allow flawless resumption after interruption.

## 3. Stability & Failure Management
*   **Fail Fast Protocol**: Absolute ban on defensive `try-catch` blocks that swallow errors. Force immediate crashes on unexpected states to expose root causes.
*   **Infrastructure Essentials (Anti-Regression)**:
    *   **Absolute Paths Only**: All scripts and unit files MUST use absolute paths. Relative path reliance is a fatal flaw in automated environments (Systemd/Cron).
    *   **Standardized Environments**: Explicitly define `User`, `Group`, `WorkingDirectory`, and `Environment (PATH, HOME)` in every service unit to prevent permission and environment mismatches.
    *   **Pre-flight Checks**: Implement logic to verify write permissions for `runs/` and `logs/` before starting the main workflow loop.
*   **Intelligent Throttling**: Use exponential backoff with jitter to navigate API rate limits.

## 4. Adherence to Iron Rules
*   **Minimization**: Code redundancy is a failure. Consolidate logic into `src/io/core.ts` and keep agent specialized functions skeletal.
*   **Intellectual Honesty**: Do not settle for "Macro-Collapse" (マクロ崩壊論) as a default narrative. Prioritize "The Joy of Discovery" and "Structural Adaptive Strategy" to maintain high-quality, non-sensationalist output.
