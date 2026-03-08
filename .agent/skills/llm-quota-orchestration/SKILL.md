---
name: llm-quota-orchestration
description: Manage API key rotation, sticky sessions, and tiered fallback across multiple Gemini keys and local models. Use when configuring multi-key LLM clusters, debugging quota exhaustion, optimizing prefix caching, or deciding which model tier to use. Triggers on "quota", "429", "key rotation", "sticky session", "rate limit", "LLM cluster", or "which model to use".
---

# LLM Quota Orchestration

## Why Sticky Sessions Matter

Prefix caching only works when the same API key receives the same system prompt prefix repeatedly. Rotating keys mid-session destroys cache hits and increases latency. Pin each workflow to one key for the duration — only break affinity on 429.

## Tiered Resilience

```
Tier 1: Gemini Cloud Cluster (multiple GEMINI_API_KEY_N)
  → parallel across keys, full context window
Tier 2: Local vLLM (Qwen3.5-9B)
  → see local-llm-orchestration for constraints
Tier 3: Fail Fast
  → terminate, preserve state, let Systemd handle restart
```

## Node Selection (Pre-flight)

1. Check for existing session affinity → use same key
2. No affinity → pick key with highest remaining quota
3. Equal quota → Least Recently Used

## Ledger Update (Post-flight)

After every API call, update the ledger immediately:
- Parse `x-ratelimit-remaining` and `x-ratelimit-reset` from response headers
- Mark exhausted keys with cooldown = `reset_time + 30s`
- Log key index, latency, and success/failure — never log key values

## Status Injection

Inject current cluster state into sub-agent system prompts:

```
[LLM Status] Provider: GEMINI_KEY_2 | Quota: 847/1000 | Mode: Standard
```

Sub-agents adjust verbosity based on mode — Standard (cloud) vs. Concise (local 4k context).
