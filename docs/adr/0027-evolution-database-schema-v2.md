# ADR 0027: Evolution DB Schema v2

## Status
Accepted

## Purpose
Store run history, artifacts, strategy state, and audit evidence in `db/evolution.db`.

## Canonical Rules
1. `db/evolution.db` is the persistent schema store.
2. `runs` and `raw_artifacts` anchor traceability.
3. `strategy_genomes`, `collapse_signals`, and `mutation_plans` support evolution tracking.
4. `audit_checks` stores the structured audit outcomes.
5. Schema changes must stay aligned with code and backfill scripts.

## Required References
- `db/evolution.db`
- `src/server.ts`
- `src/scripts/backfill_db.ts`
