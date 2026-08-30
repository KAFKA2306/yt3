---
name: youtube-operations
description: Use for any YT3 work across research, scripting, media, QA, automation, incidents, publishing, analytics, and refactoring. Resolve current truth, change the smallest canonical source, and prove the result with real evidence.
type: skill
---

# YouTube Operations

Use this as the single YT3 domain skill.

## Rule

**Observe → change → prove.**

Follow `AGENTS.md`. Treat `Taskfile.yml` as the human-facing executable interface. When documentation conflicts with current code, config, runtime, API read-back, or deterministic evidence, current evidence wins.

## Workflow

1. **Observe**
   - Read `AGENTS.md`, `Taskfile.yml`, and only the code/config/run/PR/CI/API evidence relevant to the request.
   - Identify the target profile: `byosan`, `yawa`, or `humanity`.
   - Separate what is VERIFIED, OBSERVED, INFERRED, and UNVERIFIED.

2. **Change**
   - Find the one source of truth that owns the behavior.
   - Make the smallest sufficient diff.
   - Prefer deletion and consolidation over parallel paths, duplicated state, wrappers, compatibility layers, or speculative abstractions.
   - Read volatile details such as models, paths, colors, thresholds, channel IDs, and policies from current config/standards/runtime; do not encode stale copies here.

3. **Prove**
   - Repository: targeted check → `task check:merge:fast` → `task check:merge` → exact-head CI.
   - Media: inspect the actual artifact and run the relevant deterministic audio/video/image checks.
   - Publish: `task release:check PROFILE=<profile> -- <run-id> [video-path]` → verify authenticated channel identity → perform the remote side effect only when explicitly authorized → verify receipt/read-back/visibility.
   - Analytics: use actual API-measured metrics and an explicit measurement window. Never substitute synthetic retention, engagement, subscriber, audience, or success estimates.

4. **Report**
   - State only evidence-backed results: changed source, checks actually run, exact head, merge state, artifact result, and separately verified external result.
   - Green CI proves repository acceptance, not publication or product behavior.
   - Missing target credentials/runtime/read-back means that criterion is `UNVERIFIED`, not that unrelated repository work failed.

## Profiles

| profile | product | bucket |
|---|---|---|
| `byosan` | 秒算マネー | `byosan_money` |
| `yawa` | 夜話アーカイブ ASMR | `yawa_archive` |
| `humanity` | 雨晴はうの人類観測所 | `humanity_observatory` |

Keep profile config, media, credentials, receipts, and publication state isolated.

## Never

- invent facts, metrics, artifacts, receipts, or PASS states
- hide missing inputs behind fallback output that looks successful
- publish without explicit authorization
- create a second implementation path for the same outcome
- treat branch deletion as a completion requirement
- expose secrets or private local metadata

Stop when the requested outcome reaches a verified fixed point.