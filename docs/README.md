# Docs Index

This repository uses evidence-driven daily operations.

## Daily Guarantee

- [`daily_guarantee.md`](./daily_guarantee.md): one-page entrypoint for the metric definition and operational checks
- [`content_freshness_metrics.md`](./content_freshness_metrics.md): deterministic freshness gate and thresholds
- [`../prompts/audit_log_llm.txt`](../prompts/audit_log_llm.txt): strict prompt for fact-only log auditing
- [`../logs/daily_guarantee_status.md`](../logs/daily_guarantee_status.md): combined status for metrics, freshness, and readiness
- [`../logs/stability_ready.md`](../logs/stability_ready.md): latest 3 daily runs and evidence readiness
- [`../logs/stability_summary.md`](../logs/stability_summary.md): 30-day failure classification and evidence readiness summary

## Publish

- `PROFILE=[byosan|yawa|humanity] task publish -- <run_id>`: publish an explicit run; do not infer a latest run
- `task movie:status`: report movie receipt status without changing remote state

## Standards

- [`standard/ontology-standard-reference.md`](./standard/ontology-standard-reference.md)
- [`standard/continuous-improvement-loop.md`](./standard/continuous-improvement-loop.md)
- [`standard/system-audit-protocol.md`](./standard/system-audit-protocol.md)
- [`standard/viral-retention-engineering.md`](./standard/viral-retention-engineering.md)

## ADRs

- [`adr/README.md`](./adr/README.md)
