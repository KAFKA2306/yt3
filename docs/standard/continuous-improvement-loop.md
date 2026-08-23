# Continuous Improvement Loop

YT3 improves from run evidence, not task exit codes or duplicated status files.

## Canonical evidence

1. `runs/<bucket>/<run>/run_evidence.json` is the per-run proof artifact.
2. `logs/stability_summary.json` is the canonical cross-run readiness artifact.
3. `logs/stability_summary.md` is its human-readable rendering.

`logs/improvement_report.json` and `.md` are derived analysis only. They are rebuilt directly from daily logs and run evidence and do not become another readiness source of truth.

## Entry points

- `task stability:report` regenerates cross-run readiness and failure classification.
- `task improve:report` regenerates 7-day and 30-day evidence metrics directly from source evidence.
- `task movie:status` inspects movie receipts without mutating remote state.
- `task audit:publish-routing` verifies exact publish routing.

The improvement report does not run unrelated audits as hidden prerequisites. Run a targeted audit explicitly when its result is needed.

## Success rules

A run is successful only when its required evidence exists and its critical checks pass. A terminal log line or process exit code alone is insufficient.

When publish is expected, the publish receipt and channel-specific proof must agree with the run. Fallback content, inferred latest runs, and blocked publish attempts are not successes.

## Improvement procedure

1. Read canonical run evidence and the stability report.
2. Identify one measurable failure or unnecessary state surface.
3. Change one bounded part of the system.
4. Run type checks, lint, tests, and the relevant static audit.
5. Keep the change only if evidence quality is preserved or improved.

## Logging rule

Prefer one append-only operational log and one durable evidence bundle per run. Derived summaries are regenerated from those sources rather than maintained independently.

If two generated files encode the same readiness decision, keep the more complete canonical source and delete the duplicate.