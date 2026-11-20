# Docs Index

This directory is the YT3 OKF v0.3 knowledge bundle (also usable as an Obsidian Vault). Start from [`index.md`](./index.md) for the full concept catalog and [`log.md`](./log.md) for the change history. Runtime state and generated evidence belong under `runs/`, `artifacts/`, and `logs/`.

## Channel Missions & Canons

- [`byosan/MISSION.md`](./byosan/MISSION.md): 秒算マネー（2-lane financial/tech structure analysis）
- [`yawa/MISSION.md`](./yawa/MISSION.md) & [`yawa/characters.json`](./yawa/characters.json): 夜話アーカイブ ASMR（fixed 3-character cast, all-ages advertiser-friendly）
- [`humanity/MISSION.md`](./humanity/MISSION.md), [`humanity/SOUL.md`](./humanity/SOUL.md), [`humanity/songwriting.md`](./humanity/songwriting.md), [`humanity/story-world.json`](./humanity/story-world.json): 雨晴はうの人類観測所（晴れ待ち坂 narrative music label）

## Data Model & dbt Analytics

- [`standard/ledger-standard.md`](./standard/ledger-standard.md): record locations, grains, masters, and schema owners
- [`standard/star-schema-standard.md`](./standard/star-schema-standard.md): Raw → Staging → Marts design implemented in [`../analytics/`](../analytics/dbt_project.yml) (`task analytics:build`)

## Operations & Quality Gates

- [`QUALITY_GATES.md`](./QUALITY_GATES.md): ownership of lint, typecheck, tests, and CI gates
- [`standard/environment-refresh.md`](./standard/environment-refresh.md): hourly environment refresh loop

## Publication

Use an explicit profile and run ID through the single publisher:

```bash
task publish PROFILE=byosan -- <run-id>
task publish PROFILE=yawa -- <run-id>
task publish PROFILE=humanity -- <run-id>
```

There is no latest-run inference path.

## ADRs

See [`adr/README.md`](./adr/README.md) for the historical architecture decision record index.
