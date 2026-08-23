# Daily Guarantee

YT3 treats daily interestingness as an evidence-backed production requirement, not an assumption.

## Definition

- `docs/content_freshness_metrics.md` defines the deterministic freshness gate.
- `runs/<bucket>/<run>/audit/creative_freshness_report.json` records per-run freshness evidence.
- `runs/<bucket>/<run>/run_evidence.json` is the proof artifact for a run.
- `logs/stability_summary.json` is the canonical cross-run readiness state.

There is no second daily-readiness state file. Derived reports must not duplicate the verdict already represented by the stability summary.

## Operational checks

- `task stability:report` regenerates latest-run readiness and 30-day failure classification.
- `task audit:today` checks today's production state.
- `task publish:visibility-audit` verifies remote visibility separately from local readiness.
- `task movie:status` inspects publication receipts and current YouTube state without mutating it.

## Current state

Readiness is derived from concrete run evidence. A run is not proven when required evidence is missing, regardless of task exit status.

## How to verify

1. Read `docs/content_freshness_metrics.md` for the content gate.
2. Run `task stability:report` and inspect `logs/stability_summary.md`.
3. Use `task publish:visibility-audit` when remote publication state matters.
