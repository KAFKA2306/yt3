---
name: operational-resilience
description: MANDATORY FRAMEWORK to guarantee stable system operation, resource efficiency, and strict adherence to the project's "Iron Rules." Use for all core infrastructure decisions, failure handling, and LLM strategy.
---

# Operational Resilience (Core Infrastructure)

## Position in Workflow
- **Phase**: Design / Plan / Review (Continuous operational standards)

## 📋 Rationale for Strategic Shift
1. **Deterministic Execution**: Mandate "Fail Fast" protocols. Defensive coding is prohibited to ensure failures are loud and diagnosable, preventing silent data corruption.
2. **Context Efficiency**: Utilize Gemini 3 Flash's context window with strategic prompt caching to minimize latency and operational costs while maximizing information density.
3. **Infrastructure Stability**: Explicit enforcement of absolute paths and standardized environments (Systemd/Cron) eliminates environmental mismatches in production.

---

## 1. LLM Operations (Gemini Strategy)
*   **Gemini 3 Flash Exclusive**: Prohibition of model switching. Explosive context window utilization is mandatory for simultaneous multi-source processing.
*   **Prompt Caching & Stickiness**: 
    - MANDATORY utilization of `llm-quota-orchestration` to maintain **Sticky Sessions**. 
    - Pin each workflow to a specific key index to maximize prefix caching. 
    - Sacrifice cache for availability ONLY when a 429 error occurs.
*   **JSON Enforcement**: All structured outputs must use `responseMimeType: "application/json"`. Verify parsing via `src/io/core.ts` to prevent runtime failures.

## 2. Workflow Control (LangGraph Strategy)
*   **State Minimization**: Do not persist full chat histories. Compress context into `summary` or `essence` before relaying.
*   **Safe Resume Logic**: Maintain deterministic checkpoints. Operations with side effects MUST be idempotent for flawless resumption.

## 3. Stability & Failure Management
*   **Fail Fast Protocol**: Absolute ban on defensive `try-catch` blocks. Force immediate crashes on unexpected states.
*   **No Retry in Business Logic**: Retries belong ONLY to infrastructure (Systemd `Restart=`). Hidden application-level retries mask quota exhaustion and complicate diagnosis.
*   **Infrastructure Essentials**:
    - **Absolute Paths**: Mandatory for all scripts and units.
    - **Standardized Environments**: Define `User`, `Group`, and `WorkingDirectory` in every service unit.
    - **Root-to-User Transition**: Use `ExecStartPre=+/bin/chown` to fix permission errors on output directories before privilege drop.
    - **Pre-flight Checks**: Verify write permissions for `runs/` and `logs/` before initialization.

## 4. Ethical & Analytical Standards
*   **Intellectual Integrity**: Reject sensationalist "Systemic Collapse" narratives. Prioritize "Discovery" and "Structural Adaptive Strategies" grounded in verifiable hard data.
*   **Adaptive Growth**: Focus content on empowerment through adaptive strategies rather than fear-based rhetoric.

## 5. Delivery Reporting & Transparency
*   **Mandatory Finality**: Every successful `task run` or publishing workflow MUST conclude with an explicit report of the **Final Deliverable Metadata**.
*   **Verification Protocol**:
    - **Source**: Extract the **Final Video Title** from `{runDir}/content/output.yaml` and the **Public Video URL/ID** from `{runDir}/publish/output.yaml`.
    - **Presentation**: Display these details clearly to the user immediately upon completion.
*   **Rationale**: Ensures operational transparency and immediate verification of the production output, closing the feedback loop between the agent and the user.

## ⚠️ Local LLM (Qwen3.5-9B) Constraints
- **The 4096 Trap**: DO NOT assign long-form generation to the local model. Limit tasks to research/audit/evaluation.
- **Redundancy Prohibition**: DO NOT repeat chat history. Prune context aggressively before invoking Qwen.
- **JSON Only**: Qwen MUST NOT use XML/HTML tags. Force JSON-only outputs.

## 🚫 Negative Constraints (MANDATORY)
- **DO NOT** use defensive `try-catch` blocks in business logic.
- **DO NOT** use relative paths for production scripts or units.
- **DO NOT** allow application-level retries for quota exhaustion.
- **DO NOT** switch models mid-workflow unless 429 occurs.
- **DO NOT** output redundant summaries during multi-stage processing.
