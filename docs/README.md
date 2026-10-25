# Docs Index

This directory contains maintained operational standards and architecture decisions for YT3. Runtime state and generated evidence belong under `runs/`, `audits/`, `artifacts/`, and `logs/`.

## Operations

- [`QUALITY_GATES.md`](./QUALITY_GATES.md): ownership of lint, typecheck, tests, hooks, and CI gates

## Data Model

- [`standard/star-schema-standard.md`](./standard/star-schema-standard.md): fact and dimension tables by grain, and the migration plan
- [`standard/ledger-standard.md`](./standard/ledger-standard.md): append-only records of what happened, and where each ledger lives

## Standards

- [`standard/humanity-observatory-audit-standard.md`](./standard/humanity-observatory-audit-standard.md): Humanity Observatory audit standard
- [`standard/asmr-workflow.md`](./standard/asmr-workflow.md): ASMR workflow standard

## Publication

Use an explicit profile and run ID through the single publisher:

```bash
task publish PROFILE=byosan -- <run-id>
task publish PROFILE=yawa -- <run-id>
task publish PROFILE=humanity -- <run-id>
```

There is no latest-run inference path.

## ADRs

See [`adr/README.md`](./adr/README.md) for the maintained architecture decision record index.
