---
type: "reference"
title: "Repository Record Index"
description: "YT3 のイベント記録・状態・マスタ・dbt 分析モデルの所在、粒度、スキーマ所有者を一元管理する台帳索引。"
tags:
  - yt3/standard
  - yt3/data
  - yt3/ledger
aliases:
  - "台帳正本"
  - "レコード索引"
  - "ledger-standard"
generated:
  by: "antigravity/gemini-4-neon-high"
  at: "2026-11-20T00:25:00Z"
---

# Repository record index

Find every canonical record, master file, and analytical schema owner here. Product records stay with their run; this page stores pointers, not copies. For the analytical star schema and dbt models built over `db/evolution.db`, see [Star Schema & dbt Standard](star-schema-standard.md).

## Event records

| Record | Grain | Canonical location | Format owner |
| --- | --- | --- | --- |
| Production run | One run and its artifacts | `runs/<profile>/<run-id>/` | The profile's producer and artifact schemas |
| LLM calls | One emitted event for a provider call (start, end, validation, or fallback) | `<run>/audit/llm_calls.jsonl` | `CodexLogRecord` and writer in `src/domain/byosan/codex_llm.ts` |
| Humanity music | One generation, rating, playlist, or publication event | `runs/humanity_music/ledger.jsonl` | `LedgerRowSchema` in `src/domain/humanity_music.ts`; writer in `src/scripts/humanity_music.ts` |
| Environment refresh | One refresh event | `logs/environment-refresh.jsonl` (local) | `scripts/env_refresh.sh`; event contract in [Environment Refresh Standard](environment-refresh.md) |
| Resident agent events | One resident-agent tick or state transition | `logs/resident-agent.jsonl` (local) | `src/domain/resident/ledgers.ts`; contract in [Resident Agent Standard](resident-agent-standard.md) |

## Master data & creative canons

| Master | Grain | Canonical location | Schema / owner |
| --- | --- | --- | --- |
| YouTube channel profiles | One channel profile (`byosan`, `yawa`, `humanity`) | `src/domain/youtube_profiles.ts` & `analytics/seeds/channel_profiles.csv` | `YOUTUBE_PROFILES` (`src/domain/youtube_profiles.ts`) |
| Yawa fixed cast | One adult cast member (`haruka`, `shizuku`, `nao`) | `docs/yawa/characters.json` | `YawaCastSchema` in `src/domain/yawa_daily.ts` |
| Yawa cast voice references | One persistent reference WAV per cast ID | `data/state/yawa/references/<character_id>.wav` (local) | `castReferencePath` in `src/domain/yawa_daily.ts` |
| Byosan discovery sources | One vetted external news/filing source | `config/sources/byosan_discovery_sources.json` | `DiscoverySourcesSchema` in `src/domain/byosan/discovery_sources.ts` |
| Visual design tokens | One shared light palette & layout token set | `config/design/foundation.tokens.json` | Synced via `bun src/scripts/sync_video_design.ts` |

## Current state, telemetry & analytical marts

| Record | Grain | Location | Format / transform owner |
| --- | --- | --- | --- |
| Publication state | Latest state for one run | `<run>/publish/state.json` | `CanonicalPublicationStateSchema` in `src/domain/publication_state.ts` |
| LLM quota | Current counters per key | `data/state/llm_quotas.json` | `QuotaLedger` in `src/io/utils/quota/ledger.ts` |
| Agent activity | One agent log entry | `logs/agent_activity.jsonl` (local) | `AgentLogEntry` and writer in `src/io/utils/logger.ts` |
| YouTube analytics (raw) | Video × age window, traffic source, or channel × date × video | `db/evolution.db` | `db/schema.sql` & `src/scripts/refresh_youtube_analytics.ts` |
| YouTube analytics (marts) | Channel, video × window, and channel × date × video | `data/analytics/yt3_analytics.duckdb` (local, rebuilt by `task analytics:build`) | dbt project in `analytics/` ([Star Schema & dbt Standard](star-schema-standard.md)) |
| Resident work & question ledgers | One ongoing work item (`work_id`) / one deduplicated owner question (`target` × `decision_topic`) | `data/state/resident/work_ledger.json`, `data/state/resident/question_ledger.json` (local) | `WorkLedgerSchema` / `QuestionLedgerSchema` in `src/domain/resident/ledgers.ts` ([Resident Agent Standard](resident-agent-standard.md)) |
| Owner action ledger | One owner-required action (`target` × `decision_topic`, no secrets) | [Owner Action Ledger](owner-action-ledger.md) (tracked OKF v0.3 Vault ledger) | Synced view via `task resident:ledger` ([Resident Agent Standard](resident-agent-standard.md)) |

## How to use the records

- Start with the product's canonical Taskfile command, then inspect that run's files and producer. Schemas live with the code that reads or writes each format.
- Treat quota and activity logs as operational data, not evidence that a video is public. Publication is verified by remote read-back through the canonical publisher, as described in `AGENTS.md`.
- Analytical metrics are transformed reproducibly through `task analytics:build` (`analytics/` dbt project) from raw SQLite tables in `db/evolution.db`. Unmeasured rates remain `NULL`, never fabricated zeros.
- The previous version, including historical event notes, is preserved in `docs/archive/superseded/ledger-standard.md`. It is not a current status report.
