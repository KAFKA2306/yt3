# Daily Guarantee

This repository treats "daily interestingness" as an operational guarantee with evidence, not as an assumption.

## Definition

- `content_freshness_metrics.md` defines the deterministic freshness gate.
- `creative_freshness_report.json` captures the per-run freshness evidence.
- `run_evidence.json` is the proof artifact for a run. If it is missing, the run is not treated as proven.

## Operational Checks

- `logs/stability_summary.md` contains both the latest 3-run evidence readiness and the 30-day failure classification.
- `logs/daily_guarantee_status.md` combines the metric definition with the current readiness verdict.
- `logs/daily_guarantee_status.md` also lists the latest published URL for `秒算マネー` and `人類観測所` separately.
- `logs/public_visibility_audit.md` lists whether each published video is actually public.
- `task movie:status` or `bun run movie:status` reports the status of all movie receipts without changing state.

## Current State

Readiness is derived from concrete run evidence. The latest three runs must each have a run directory and pass the evidence checks before the daily guarantee is considered ready.

## How To Verify

1. Read `docs/content_freshness_metrics.md`.
2. Read `logs/stability_summary.md` and confirm the latest 3 runs report `evidence_ready: yes`.
3. Read `logs/daily_guarantee_status.md` for the combined verdict and latest published URLs.
