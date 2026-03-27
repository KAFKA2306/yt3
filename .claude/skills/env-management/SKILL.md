---
name: env-management
description: Audit and enforce environment variable rules before any task that touches API keys or config. Use before running pipelines, debugging auth failures, or setting up a new environment. Triggers on "check env", "missing key", "API key", ".env", "GEMINI_API_KEY", or any config-related pre-flight check.
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

- Load via `bun --env-file=config/.env` or explicit `dotenv` at every entry point. No implicit env inheritance.
- Source of truth is `src/domain/types.ts`. Every variable defined there must be present at startup or the process crashes — no fallbacks.
- Placeholder values (`your_key_here`, `TODO`, `REPLACE_ME`) are treated as missing. The process must crash with a clear message pointing to the missing key name.
- `.env` stays in `.gitignore`. If it's committed, treat it as a credential leak and rotate immediately.
- Never log key values — log key names and status only (present/missing/invalid).
