---
description: refactor code to follow iron rules (minimize, DRY, config-driven, no comments, fail fast, BaseAgent, Japanese-only)
---
# Refactor to Iron Rules

1. **Read rules**: Open `.agent/skills/design_system/SKILL.md` for the design system rules.
2. **Audit**: Scan `src/` for violations:
   - Comments → delete
   - `try-catch` blocks → replace with fail-fast
   - Hardcoded values → move to `config/default.yaml`
   - Duplicated logic → consolidate to `src/core.ts`
   - Missing `BaseAgent` inheritance → fix
   - `any` types → replace with concrete types
3. **Fix**: Apply changes file by file.
4. **Verify**:
// turbo
```bash
task lint
```
// turbo
```bash
npm test
```
