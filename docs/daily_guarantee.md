# Daily Guarantee

This repository treats "daily interestingness" as an operational guarantee with evidence, not as an assumption.

## Definition

- `content_freshness_metrics.md` defines the deterministic freshness gate.
- `creative_freshness_report.json` captures the per-run freshness evidence.
- `run_evidence.json` is the proof artifact for a run. If it is missing, the run is not treated as proven.

## Operational Checks

- `logs/stability_summary.md` summarizes the last 30 days of failures by cause.
- `logs/stability_ready.md` shows whether the latest 3 daily runs have concrete evidence.
- `logs/daily_guarantee_status.md` combines the metric definition with the current readiness verdict.
- `logs/daily_guarantee_status.md` also lists the latest published URL for `秒算マネー` and `人類観測所` separately.
- `logs/public_visibility_audit.md` lists whether each published video is actually public.
- `task movie:status` or `bun run movie:status` reports the status of all movie receipts without changing state.

## Current State

- The system is ready to report daily stability once 3 real days of evidence exist.
- Today, the latest 3 runs still have `evidence_ready=false`.
- The readiness checks intentionally fail until that condition changes.

## How To Verify

1. Read `docs/content_freshness_metrics.md`.
2. Read `logs/daily_guarantee_status.md`.
3. Read `logs/stability_ready.md`.
4. Confirm the latest 3 runs all report `evidence_ready: yes`.
