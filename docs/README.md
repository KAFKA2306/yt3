# Docs Index

This directory contains the maintained operational standards and architecture decisions for YT3. Runtime state and generated evidence belong under `runs/`, `audits/`, `artifacts/`, and `logs/`; this index links only to version-controlled documentation.

## Operations

- [`daily_guarantee.md`](./daily_guarantee.md): daily guarantee definition and status checks
- [`content_freshness_metrics.md`](./content_freshness_metrics.md): deterministic freshness metrics and thresholds
- [`QUALITY_GATES.md`](./QUALITY_GATES.md): ownership of lint, typecheck, tests, hooks, and CI gates

## Standards

- [`standard/system-audit-protocol.md`](./standard/system-audit-protocol.md): system audit protocol
- [`standard/continuous-improvement-loop.md`](./standard/continuous-improvement-loop.md): improvement-loop evidence flow
- [`standard/humanity-observatory-audit-standard.md`](./standard/humanity-observatory-audit-standard.md): Humanity Observatory audit standard
- [`standard/kafka-visual-identity.md`](./standard/kafka-visual-identity.md): shared visual identity rules
- [`standard/viral-retention-engineering.md`](./standard/viral-retention-engineering.md): retention-oriented production standard
- [`standard/asmr-workflow.md`](./standard/asmr-workflow.md): ASMR workflow standard

## Publication

Use an explicit run ID. The safe channel-specific entry points delegate to the same publisher:

```bash
task publish:byosan -- <run-id>
task publish:yawa -- <run-id>
task publish:humanity -- <run-id>
task publish PROFILE=byosan -- <run-id>
task movie:status
```

There is no latest-run inference path.

## ADRs

See [`adr/README.md`](./adr/README.md) for the maintained architecture decision record index.
