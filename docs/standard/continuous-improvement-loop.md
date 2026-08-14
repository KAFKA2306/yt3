# Continuous Improvement Loop

YT3 improves from run evidence, not from task exit codes or duplicated status files.

## Canonical evidence chain

1. `runs/<bucket>/<date>/run_evidence.json` is the per-run proof artifact.
2. `logs/stability_summary.json` is the canonical cross-run status artifact. It contains:
   - latest run readiness
   - present and absent buckets
   - missing evidence
   - 30-day failure classification inputs
3. `logs/stability_summary.md` is the human-readable rendering of the same status.
4. `logs/daily_guarantee_status.json` combines the stability summary with freshness documentation and latest publish proof.
5. `logs/daily_guarantee_status.md` is its human-readable rendering.

Do not create another readiness artifact when the information can be derived from `stability_summary.json`.

## Entry points

- `task daily:report`: regenerate the daily audit, stability summary, and daily guarantee status.
- `task improve:report`: regenerate the daily report plus the additional improvement inputs.
- `task movie:status`: inspect movie receipts without mutating remote state.
- `task audit:publish-routing`: verify exact publish routing.

## Success rules

A run is successful only when its required evidence exists and its critical checks pass. A terminal log line or process exit code alone is insufficient.

When publish is expected, the publish receipt and channel-specific proof must agree with the run. Fallback content, inferred latest runs, and blocked publish attempts are not successes.

## Improvement procedure

1. Regenerate the canonical reports.
2. Identify one measurable failure or unnecessary state surface.
3. Change one bounded part of the system.
4. Run type checks, lint, tests, and the relevant static audit.
5. Keep the change only if evidence quality is preserved or improved.

## Logging rule

Prefer one append-only operational log and one durable evidence bundle per run. Derived summaries should be regenerated from those sources rather than maintained independently.

The default is consolidation: if two generated files encode the same readiness decision, keep the more complete source and delete the other path.
