# Repository record index

Find a record and its schema owner here. Product records stay with their run; this page stores pointers, not copies.

## Event records

| Record | Grain | Canonical location | Format owner |
|---|---|---|---|
| Production run | One run and its artifacts | `runs/<profile>/<run-id>/` | The profile's producer and artifact schemas |
| LLM calls | One emitted event for a provider call (start, end, validation, or fallback) | `<run>/audit/llm_calls.jsonl` | `CodexLogRecord` and writer in `src/domain/byosan/codex_llm.ts` |
| Humanity music | One generation, rating, playlist, or publication event | `runs/humanity_music/ledger.jsonl` | `LedgerRowSchema` in `src/domain/humanity_music.ts`; writer in `src/scripts/humanity_music.ts` |
| Environment refresh | One refresh event | `logs/environment-refresh.jsonl` (local) | `scripts/env_refresh.sh`; event contract in `docs/standard/environment-refresh.md` |

## Current state and telemetry

| Record | Grain | Location | Format owner |
|---|---|---|---|
| Publication state | Latest state for one run | `<run>/publish/state.json` | `CanonicalPublicationStateSchema` in `src/domain/publication_state.ts` |
| LLM quota | Current counters per key | `data/state/llm_quotas.json` | `QuotaLedger` in `src/io/utils/quota/ledger.ts` |
| Agent activity | One agent log entry | `logs/agent_activity.jsonl` (local) | `AgentLogEntry` and writer in `src/io/utils/logger.ts` |
| YouTube analytics | Video and age window, traffic source, or daily reach, depending on the table | `db/evolution.db` | `db/schema.sql` and ingestion scripts in `src/scripts/` |

## How to use the records

- Start with the product's canonical Taskfile command, then inspect that run's files and producer. Schemas live with the code that reads or writes each format.
- Treat quota and activity logs as operational data, not evidence that a video is public. Publication is verified by remote read-back through the canonical publisher, as described in [`AGENTS.md`](../../AGENTS.md).
- The previous version, including historical event notes, is preserved in [`docs/archive/superseded/ledger-standard.md`](../archive/superseded/ledger-standard.md). It is not a current status report.
- For analytical table grain and retention, see the [star schema standard](./star-schema-standard.md).
