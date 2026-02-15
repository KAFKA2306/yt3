---
description: safe dry-run to verify changes without publishing or making real API calls
---
# Dry Run Verification

// turbo
1. Ensure services are running:
```bash
task status
```
// turbo
2. Run with cached LLM and no publishing:
```bash
task dryrun
```
3. Inspect the generated output in `runs/[RUN_ID]/`.
4. If a specific step needs testing:
// turbo
```bash
DRY_RUN=true SKIP_LLM=true npx tsx src/step.ts [step_name]
```
Valid step names: `research`, `content`, `content:fix`, `media`, `publish`, `evaluate`.
