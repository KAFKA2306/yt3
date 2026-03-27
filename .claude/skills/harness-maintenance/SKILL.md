---
name: harness-maintenance
description: Enforce and maintain the autonomous harness infrastructure. Make sure to use this skill whenever the user mentions ADRs, hooks, linter config, repository rot, or when making any structural decision or completing a task session, even if they don't explicitly ask for 'harness maintenance'. You must trigger this skill to validate repository health.
---

# Harness Maintenance Protocol

## Directives

Execute repository defense mechanisms to prevent documentation rot, configuration drift, and test decay. You must enforce these rules strictly.

## Iron Rules

**ADR Strict Enforcement**
Create a new ADR in `docs/adr/` for ALL architectural decisions, dependency changes, or pattern shifts. Do not proceed without an ADR.

**Hook Integrity**
Never disable, bypass, or weaken local hooks defined in `.claude/settings.json`. Fix the code. Never fix the hook to accommodate broken code.

**Doctor Validation**
Run `task harness:doctor` at the end of every task or session. Resolve all reported issues immediately. Do not ignore doctor warnings.

**Linter Primacy**
Enforce strict Biome rules (`noExplicitAny: error`). Do not use `// biome-ignore` to hide architectural violations. Fix the underlying type errors.

## Execution Patterns

### The "Doctor" Loop

1. Complete task implementation.
2. Execute `task harness:doctor`.
3. Fix all detected rot immediately.
4. Commit with a strict English semantic message.

### ADR Life Cycle

1. Execute `task adr:new -- title="Detailed Decision Name"`.
2. Populate the generated template in `docs/adr/`.
3. Do not reference ADR IDs in code comments. Maintain zero-fat code.

### Config Protection

Treat `biome.json`, `Taskfile.yml`, and `.claude/settings.json` as completely immutable unless the specific task is to evolve the harness.
