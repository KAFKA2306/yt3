---
description: destructive redesign of a feature or the entire pipeline
---
# Destructive Redesign

Use when the user says "destruct", "destructive", "rebuild", or "overhaul".

1. **Scope**: Confirm what is being destroyed (agent, pipeline stage, prompts, config).
2. **Audit**: Read the current implementation thoroughly before deleting anything.
3. **Plan**: Create `implementation_plan.md`. Get user approval before executing.
4. **Execute**: Delete old code first, then build new. Do not leave dead code.
5. **Verify**:
// turbo
```bash
task lint
```
// turbo
```bash
task dryrun
```
6. **Commit** (if user approves):
```bash
git add -A && git commit -m "destruct: [description]"
```
