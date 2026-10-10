# Ledger Standard

## Purpose

A ledger is the record of what happened: state transitions, failures, decisions, and external side effects, each with time and a hash. The ledger is the evidence layer. Analysis is built from it in the [star schema](./star-schema-standard.md), and meaning is defined by the [ontology](./ontology-standard.md).

## Rules

1. **One canonical ledger per fact.** A fact is recorded in one place. Other views are derived from it, never written separately.
2. **Append-only.** Entries are added, not edited or deleted. A correction is a new entry that references the one it corrects.
3. **Every entry is traceable.** Each entry carries a timestamp, the run or profile it belongs to, the code revision (`git` HEAD) that produced it where applicable, and a hash of its payload where it is an artifact.
4. **Current state is a projection.** "Current" is derived from the latest entries and is never the only record.
5. **External side effects need a receipt.** A publish, schedule, or delete is recorded as an attempt, followed by a read-back entry. Without the read-back, the state is UNVERIFIED.

## Ledgers in this repository

| ledger | canonical location | records | status |
|---|---|---|---|
| Run ledger | `runs/<profile>/<run-id>/` (`research/`, `source/`, `audit/`, `publish/`) | each production execution and its artifacts | VERIFIED: directories exist |
| Run table | `db/schema.sql` `runs`, `raw_artifacts` | run lifecycle and artifact hashes | VERIFIED: table defined |
| Failure ledger | `runs/byosan_money/<date>-daily/audit/failure_trace.json` | failure class, stage, fingerprint, retry policy, repair resolution | VERIFIED: file written on failure |
| Publication state | `src/domain/publication_state.ts` (`CanonicalPublicationStateSchema`) | canonical publish state per run | VERIFIED: schema exists |
| Analytics | `db/schema.sql` `youtube_analytics` | API-measured metrics, 30-day window | VERIFIED: table defined |
| LLM quota | `data/state/llm_quotas.json` (`src/io/utils/quota/ledger.ts`) | quota usage per key | VERIFIED: path in code |

## Known deviations (UNVERIFIED against the rules above)

- The failure ledger is overwritten on each new failure with the same fingerprint. Rule 2 is not met yet. Target: append each occurrence as an entry, and keep the current status as a projection.
- The run ledger and the run table are not yet linked by a shared run identifier. Target: `runs/<run-id>` is the key in both.
- Whether every publish attempt writes a read-back entry is not verified for all profiles.

## Retention

- Ledger entries are kept. Archival moves them to `docs/archive/` or an archive directory; it never deletes them.
- The one exception is the analytics window in the [star schema standard](./star-schema-standard.md): data past the 30-day authorization boundary is purged as required by policy.
