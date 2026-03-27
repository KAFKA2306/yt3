---
name: env-management
description: Audit and enforce environment variable rules before any task that touches API keys or config. Use before running pipelines, debugging auth failures, or setting up a new environment. Triggers on "check env", "missing key", "API key", ".env", "GEMINI_API_KEY", or any config-related pre-flight check.
type: skill
---

# Environment Management

## Why This Matters

Missing or misconfigured env vars cause silent failures deep in pipelines — hours of debugging tracing back to a typo in `.env`. Catching them at the boundary, before execution, is the only reliable approach.

## Key Naming Convention

```
GEMINI_API_KEY_1, GEMINI_API_KEY_2, ..., GEMINI_API_KEY_N
```

`GEMINI_API_KEY` (no index) is an alias for `GEMINI_API_KEY_1`. This supports round-robin rotation in `llm-quota-orchestration` without ambiguity.

## Pre-flight Audit

```bash
grep -c "GEMINI_API_KEY_" config/.env   # count keys
bun run src/io/utils/check_env.ts       # verify connectivity
```

Never `cat config/.env` in logs — use `grep` for key names only, never values.

## Rules
