# Star Schema Standard

## Status

Target model. The layers below are adopted as the design target; implementation is staged (P0–P3, see Migration). Current code does not yet match the full target, and each gap is marked UNVERIFIED or as a planned step.

## Purpose

Represent preparation (research, script, audio, video, audit) and publication (publish, schedule, measure) in one logical model, so that state and evidence are traceable from one source per fact. The ledger that records each event is defined in [ledger-standard.md](./ledger-standard.md). The meaning of the objects is defined in [ontology-standard.md](./ontology-standard.md).

## Layers

### 1. Raw layer (append-only)

- Stores first-party sources, API responses, and generated artifacts as received.
- Existing table: `raw_artifacts` (`db/schema.sql`). Every row carries a hash and a capture time.
- Rows are never updated or deleted. A mistake is corrected by a later transform.

### 2. Transform layer (reproducible)

- Derives normalized data from raw data through versioned SQL or TypeScript.
- Each transform records input hash, transform version, and output hash on its `runs` record, so that the same input can be shown to yield the same output.

### 3. Star layer (analysis and audit)

Each fact table has exactly one grain.

| fact table | grain | measures | foreign keys |
|---|---|---|---|
| `fact_production_run` | 1 run | duration, segment count, retry count, failure code | dim_date, dim_profile, dim_topic |
| `fact_audit_check` | run × audit rule | PASS/FAIL, observed value | dim_profile, dim_check_rule |
| `fact_publication` | 1 publish attempt | visibility, publish_at, read-back result | dim_date, dim_profile, dim_channel |
| `fact_analytics_daily` | video × day × metric | views, retention, CTR (API-measured only) | dim_date, dim_profile |

Dimension tables: `dim_date`, `dim_profile` (`byosan`, `yawa`, `humanity`), `dim_channel`, `dim_topic`, `dim_source`, `dim_check_rule`, `dim_asset`.

Rules:

- Analytics values are stored only when measured by the API. Estimates are never mixed in.
- The 30-day retention boundary of `analytics:refresh` applies to `fact_analytics_daily` as well.

## Object layer

Above the star layer sits the object layer that carries business meaning. Object types and relations are defined in `config/ontology/yt3.yaml`, which is the machine-checked source (`task audit:ontology`).

Actions are the only way to change object state:

- `prepare_run`: create a Run, and produce Script and Asset.
- `publish`: run only when every AuditCheck is PASS, `task release:check` is PASS, and the publish-destination guard ([ADR-0038](../adr/0038-publish-destination-guard.md)) is satisfied. Completion is confirmed by read-back.
- `schedule`: set `publish_at`. Requires the same preconditions as `publish`.

## Evidence status

- VERIFIED: the structure of `db/schema.sql`; the existence of `src/domain/publication_state.ts` and the `youtube_analytics` table.
- UNVERIFIED: current data volume in the DB; where Byosan run-level data lives (files under `runs/` or DB rows); which tables are actually read.

## Migration (each stage keeps existing behavior)

1. P0: define object types and relations in `config/ontology/yt3.yaml`. Check with `task audit:ontology`.
2. P1: build the star layer as read-only views over existing tables (`runs`, `audit_checks`, `youtube_analytics`).
3. P2: wrap the existing `prepare` and `publish` processing as actions, and add precondition checks.
4. P3: stop direct writes to legacy tables and route all writes through actions.

Each stage passes `task check:merge:fast` and is confirmed by read-back.

## Open questions

- DB partitioning: one `db/evolution.db`, or one per profile.
- Whether Byosan run-level data is in the DB or only in files.
- Relation to [ADR-0027](../adr/0027-evolution-database-schema-v2.md): update, or new.
- On audit FAIL: only block publication, or also regenerate the Topic.

## Foundry

Palantir Foundry is a paid SaaS, and the technology policy forbids adding a new paid contract without approval. The same pattern (Raw → Transform → Object → Action, with lineage) is implemented here with SQLite and versioned transforms. Adopting Foundry requires explicit approval of the contract.
