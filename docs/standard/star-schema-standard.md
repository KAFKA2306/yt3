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
| `fact_script_selection` | 1 source script × selection decision | selected (0/1), reason code, duration in minutes, credit requirement | dim_date, dim_profile, dim_source |

Dimension tables: `dim_date`, `dim_profile` (`byosan`, `yawa`, `humanity`), `dim_channel`, `dim_topic`, `dim_source` (one row per external script source, with its license and credit terms), `dim_check_rule`, `dim_asset`.

Rules:

- Analytics values are stored only when measured by the API. Estimates are never mixed in.
- The 30-day retention boundary of `analytics:refresh` applies to `fact_analytics_daily` as well.

### Transformation boundaries (dbt-inspired design target)

The target follows the separation of staging, intermediate, and marts models described in the [dbt project-structure guide](https://docs.getdbt.com/best-practices/how-we-structure/1-guide-overview). These names define responsibilities; they do not add a dbt runtime or change the current SQLite and versioned SQL/TypeScript implementation.

| boundary | responsibility | target checks |
|---|---|---|
| Raw | Preserve source payloads and generated artifacts with provenance and hashes. | Source identity, capture time, and payload hash are present. |
| Staging | Normalize one source at a time: names, types, and source-specific shapes. Preserve its row grain; do not define business KPIs here. | Required fields and source keys parse consistently. |
| Intermediate | Perform purpose-built joins, filters, and calculations that prepare data for a mart. Declare the input and output grain. | Join cardinality and grain changes are explicit and reproducible. |
| Marts | Expose business-facing dimensions, facts, and agreed KPI values. Each fact has one declared grain. | Keys, relationships, metric definitions, and source lineage match the declared contract. |

In the existing model, staging and intermediate belong to the reproducible Transform layer; marts correspond to the Star layer. These are target boundaries, not a claim that matching model folders or automated checks already exist. Build them incrementally as read-only views before changing existing writes.

An intermediate model must have a specific transformation purpose, such as isolating a complex join or an explicit grain change. A simple staging-to-mart path can remain direct when an intermediate step adds no clarity; do not create empty layers for their own sake.

### KPI definition contract (target)

Each KPI has one canonical definition, reused by every report that presents it. Its contract records:

- stable metric ID and business meaning;
- formula and source fields;
- fact grain, time window, unit, and filters or exclusions;
- whether the value is API-measured or derived, with links to its evidence;
- definition version and the transform version that produced the value.

Measured values, derived values, and estimates remain distinguishable. A change to meaning, formula, grain, source, or exclusions is a semantic change and is reviewed as one bounded change unit; routine model output is checked against the approved contract.

### Change review and acceptance evidence (target)

AI-generated data changes should be proposed in small units with a named output, declared grain, input evidence, and exact acceptance checks. Automatable checks should cover parsing, keys and relationships, grain, required provenance, and reproducibility where the transform is deterministic. Store the check result with the input and output hashes so a reviewer can inspect the evidence without manually approving every generated row.

Human review is reserved for changes to business meaning, KPI definitions, source authority, data exposure, or other decisions that cannot be established from the declared contract. These analytics checks do not add a publication prerequisite or change the product publication path.

## Object layer

Above the star layer sits the object layer that carries business meaning. Object types and relations are defined in stage P0 below; no machine-checked source exists yet.

Actions are the only way to change object state:

- `prepare_run`: create a Run, and produce Script and Asset.
- `publish`: run only when every AuditCheck is PASS, `task release:check` is PASS, and the publish-destination guard ([ADR-0038](../adr/0038-publish-destination-guard.md)) is satisfied. Completion is confirmed by read-back.
- `schedule`: set `publish_at`. Requires the same preconditions as `publish`.

## Evidence status

- VERIFIED: the structure of `db/schema.sql`; the existence of `src/domain/publication_state.ts` and the `youtube_analytics` table.
- UNVERIFIED: current data volume in the DB; where Byosan run-level data lives (files under `runs/` or DB rows); which tables are actually read.

## Migration (each stage keeps existing behavior)

1. P0: define object types and relations in a machine-checked source.
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
