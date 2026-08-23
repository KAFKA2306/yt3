# ADR 0027: Evolution DB Schema v2

## Status
Accepted

## Purpose
Define the runtime SQLite schema for run history, artifacts, strategy state, analytics, and audit evidence.

## Canonical Rules
1. `db/schema.sql` is the repository source of truth for the SQLite schema.
2. `db/*.db` is runtime state and is not tracked as repository evidence.
3. `runs/<bucket>/<run>/` remains the source evidence for run and publication facts.
4. Database ingestion must derive values from source evidence; synthetic historical metrics are prohibited.
5. `strategy_genomes`, `collapse_signals`, and `mutation_plans` may support runtime evolution tracking without replacing run evidence.

## Required References
- `db/schema.sql`
- `runs/<bucket>/<run>/`
- `src/server.ts`
- `src/scripts/ingest_youtube_analytics.ts`
