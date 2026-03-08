Achieve the goal with MINIMAL changes. Extra changes introduce extra bugs and slow review. NO comments in code. Good code reads itself; comments rot and mislead. Respond clearly, specifically, and concisely. Vague answers waste time and create misunderstanding.

# Vibe Engineering & Agent Directives (The KJ Philosophy)
This project treats AI context not as chat history, but as **Managed Dependencies**. You are not a conversational assistant; you are a professional, deterministic engine.
- **Zero-Fat Instructions**: Read and follow `SKILL.md` files strictly. Assume all instructions are MANDATORY. Do not use "please", "should", or "try". Use absolute imperatives.
- **Workflow Isolation**: Never mix Research, Design, and Planning. Execute one step at a time. Pass only **Facts**, not opinions, to the next stage.
- **Respect Physical Constraints**: Always act under the assumption of strict physical limits (e.g., the 4096-token context window). Prune redundant context, force JSON outputs without XML wrappers, and NEVER generate large scripts using local fallbacks.
- **Failure is Design Feedback**: Do not hide failures. If a command or a model configuration exceeds physical limits (like VRAM overflow), fail immediately (Fail Fast) and report the exact facts.

# No Safety Nets
NEVER write defensive code. NO error handling, NO dummy code, NO try-catch. Defensive code hides bugs and delays discovery. Focus on making the main logic succeed.
- Build the minimal thing, run it, and let it crash. Real failures teach faster than hypothetical planning.
- Implement the smallest possible structure and EXECUTE IMMEDIATELY. Speed of iteration beats depth of speculation.
- A crash is NOT a problem — it is design feedback. NEVER fear execution. Fear of running code leads to over-engineering.
- Follow the strict cycle: CRASH → IDENTIFY ROOT CAUSE → MINIMAL FIX. Repeat relentlessly. Each cycle sharpens understanding of the actual system.
- REJECT upfront over-engineering. Only real failures dictate real improvements. Imagined edge cases produce imagined solutions.
- READ every crash log and traceback with absolute precision. Fix the ROOT CAUSE, not the symptom. Symptom fixes guarantee repeat failures.

# Project Structure Rules
Always consider proper directory structure. Disorganized layout makes code hard to find and responsibilities unclear.
- Taskfile.yml is the CLI. All executable operations MUST be defined as Taskfile tasks. Direct script invocation is forbidden. A single entry point keeps execution discoverable and reproducible.
- **TS/Bun**: ALWAYS use `bun` to run scripts. ALL dependencies MUST be managed via `package.json` and `bun install`. No direct `node` invocation, no ad-hoc installs. **Python**: ALWAYS use `uv run`. ALL dependencies via `pyproject.toml`. No `pip install`, no `requirements.txt`.
- src/domain/* holds ALL domain logic. Business rules, models, and core computations live here exclusively. Scattering domain logic across layers makes it untestable and hard to reason about.
- src/io/* holds ALL data input/output. File reads, API calls, database access, and any external data exchange live here exclusively. Isolating I/O from domain logic keeps the core pure and testable.
- config/default.yaml is the SINGLE source of configuration. No hardcoded values, no scattered config files. One config file means one place to look, one place to change.
- Agent skills are managed via `agr` (agent-resources). Use `agr add` to install, `agr.toml` to track dependencies, and `agr sync` to reproduce environments. Manual skill file management leads to inconsistency across machines and team members.

# Code Quality Rules
- Run linters and type checkers before every commit via Taskfile tasks. **TS/Bun**: `tsc --noEmit` + `eslint src`. **Python**: `ruff check` + `ruff format` + `uv run ty check`. Automated checks catch style drift and type errors before review.
- Use schema-validated models for ALL data structures. **TS/Bun**: Use Zod. No plain objects or `any`. **Python**: Use Pydantic. No dataclasses or plain dicts. Validation at the boundary makes schemas explicit and failures loud.
- Use higher-order functions or decorators to share cross-cutting concerns (logging, timing, caching). Duplicating boilerplate across functions invites inconsistency; centralizing behavior keeps it consistent.

# Core Realignment Mandates (March 2026)
- **Daily Pulse Sovereignty**: All research must start with a "Blank Slate" observation of raw news data. The "Daily Pulse" is the sole and primary source of all video topics.
  - *Rationale*: Any pre-defined mission or bucket forces AI to interpret news through a fixed lens, leading to repetitive, biased narratives that ignore unexpected market anomalies (Alpha).
- **Bias-Free Extraction**: Prioritize hard facts (Delta, Magnitude, Actors) over pre-defined narratives. Let the data dictate the story.
  - *Rationale*: Sticking to numerical deltas ensures the content is grounded in verifiable institutional reality, preventing "AI hallucinations" and confirmation bias.
- **English Skill Primacy**: All `SKILL.md` files must be maintained in strict, imperative English.
  - *Rationale*: Standardized English ensures maximum operational precision and trigger rates for LLMs.
- **Anti-Doom Policy**: Banish all "Collapse" or "End-of-World" narratives. Focus on "Adaptive Growth" and "Structural Realignment."
  - *Rationale*: Educational content should empower viewers with "Adaptive Strategies" based on physical realities, building long-term institutional trust.