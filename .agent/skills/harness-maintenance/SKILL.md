---
name: harness-maintenance
description: Enforce and maintain the autonomous harness infrastructure (ADRs, Hooks, Doctor). Use whenever making architectural decisions, modifying repository guardrails, or completing a task session. Triggers on "ADR", "hook", "linter config", "harness", "repository rot", or task completion.
---

# Harness Maintenance Protocol

## Why Harness Maintenance

A self-autonomous repository must defend itself against documentation rot, configuration drift, and test decay. The harness is the agent's "training wheels" and "safety net." Investing in harness integrity is a compounding benefit for every future session.

## Iron Rules

**ADR First.** No architectural decisions, major dependency changes, or pattern shifts without creating a new ADR in `docs/adr/`. If it isn't in an ADR, it didn't happen.

**Hook Integrity.** Never disable, bypass, or weaken local hooks defined in `.claude/settings.json`. If a hook fails, fix the code, not the hook.

**Doctor Validation.** Always run `task harness:doctor` at the end of every task or session. Resolve all reported "rot" (stale links, dummy tests) immediately.

**Linter Primacy.** Strict Biome rules (especially `noExplicitAny: error`) are non-negotiable. Do not use `// biome-ignore` to hide architectural violations.

## Patterns

**The "Doctor" Loop:**
1. Complete task implementation.
2. Run `task harness:doctor`.
3. If rot detected (e.g., stale README links from renamed files), fix it.
4. Commit with a descriptive message.

**ADR Life Cycle:**
1. Identify a need for a design decision.
2. Run `task adr:new -- title="Detailed Decision Name"`.
3. Populate the generated template in `docs/adr/`.
4. Reference the ADR ID in code comments if absolutely necessary for context (though zero-fat is preferred).

**Config Protection:**
Treat `biome.json`, `Taskfile.yml`, and `.claude/settings.json` as immutable unless the task explicitly requires harness evolution.
