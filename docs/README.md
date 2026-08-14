# Docs Index

This repository uses evidence-driven daily operations.

## Daily Guarantee

- [`daily_guarantee.md`](./daily_guarantee.md): one-page entrypoint for the metric definition and operational checks
- [`content_freshness_metrics.md`](./content_freshness_metrics.md): deterministic freshness gate and thresholds
- [`../prompts/audit_log_llm.txt`](../prompts/audit_log_llm.txt): strict prompt for fact-only log auditing
- [`../logs/daily_guarantee_status.md`](../logs/daily_guarantee_status.md): combined status for metrics, freshness, and readiness
- [`../logs/stability_summary.md`](../logs/stability_summary.md): latest 3 readiness plus 30-day failure classification

## Publish

Use an explicit run ID. The safe channel-specific entrypoints all delegate to the same publisher:

- `task publish:byosan -- <run_id>`
- `task publish:yawa -- <run_id>`
- `task publish:humanity -- <run_id>`
- `PROFILE=[byosan|yawa|humanity] task publish -- <run_id>`: generic entrypoint
- `task movie:status`: report movie receipt status without changing remote state

There is no latest-run inference path.

## Standards

- [`standard/ontology-standard-reference.md`](./standard/ontology-standard-reference.md)
- [`standard/continuous-improvement-loop.md`](./standard/continuous-improvement-loop.md)
- [`standard/system-audit-protocol.md`](./standard/system-audit-protocol.md)
- [`standard/viral-retention-engineering.md`](./standard/viral-retention-engineering.md)

## ADRs

- [`adr/README.md`](./adr/README.md)
