# YT3 — Auditable Autonomous Media Operations

[![CI](https://github.com/KAFKA2306/yt3/actions/workflows/ci.yml/badge.svg)](https://github.com/KAFKA2306/yt3/actions/workflows/ci.yml)

YT3 is a resumable media-production and YouTube-operations system. `Taskfile.yml` is the canonical operator interface; internal scripts are implementation details.

```bash
task --list
```

## Canonical flow

```text
source / event
  -> research
  -> verified facts
  -> script
  -> media
  -> audit
  -> product release gate
  -> channel verification
  -> private upload
  -> remote read-back
  -> requested visibility
  -> receipt / analytics evidence
```

Core rules:

- Facts retain provenance.
- Missing evidence, ambiguous routing, or uncertain remote state fails closed.
- `Taskfile.yml` owns operator entry points.
- `YOUTUBE_PROFILES` owns channel, bucket, env-file, and token routing.
- State enables resumption; evidence proves what happened.
- Repository merge, product release, and remote publication are separate decisions.

## Setup and repository gate

```bash
task setup
task check:merge
task check:merge:fast   # deterministic preflight
```

The repository gate checks source/repository state only: lint, types, repository contract, static publish routing, source no-fallback policy, and tests. It does not require production OAuth, a specific run, or live YouTube state.

See [docs/QUALITY_GATES.md](docs/QUALITY_GATES.md).

## Production

```bash
task loop
task run                       # 秒算マネー by default
PROFILE=humanity task run      # 人類観測所
task byosan:daily
```

`task run` resolves the workflow bucket and environment from `YOUTUBE_PROFILES`; it does not maintain a second profile-to-config mapping. 夜話アーカイブ uses the ASMR operator path rather than `src/index.ts`.

Use explicit run IDs when resuming or publishing. Publication never infers an unrelated latest run.

## Release and publication

| profile | brand | bucket |
|---|---|---|
| `byosan` | 秒算マネー | `byosan_money` |
| `yawa` | 夜話アーカイブ ASMR | `yawa_archive` |
| `humanity` | 雨晴はうの人類観測所 | `humanity_observatory` |

```bash
task release:check PROFILE=byosan -- <run-id> [video-path]
task publish PROFILE=byosan -- <run-id> [video-path]
task auth PROFILE=byosan
```

Use `PROFILE=yawa` or `PROFILE=humanity` for the other channels. Unknown profiles fail closed. Before any YouTube side effect, publication runs the product release gate and verifies the authenticated channel against the selected profile. An unresolved remote upload intent blocks another upload.

## Publication evidence

`runs/<domain>/<run>/publish/state.json` is the canonical publication state. Receipts and attestations are evidence attached to it, not competing state machines.

```text
runs/<domain>/<run>/state.json
runs/<domain>/<run>/audit/
runs/<domain>/<run>/publish/state.json
runs/<domain>/<run>/publish/*.json
runs/<domain>/<run>/run_evidence.json
db/
```

A generated media file is not proof of publication. A local receipt is not proof of current remote visibility.

## Audit and status

```bash
task audit:today
task audit:publish-routing
task audit:byosan-money
task audit:no-fallback SCOPE=source
task audit:no-fallback SCOPE=runtime
task audit:no-fallback
task publish:visibility-audit
task stability:report
task improve:report
```

`logs/stability_summary.json` is the canonical cross-run readiness state. `improve:report` derives its 7-day and 30-day evidence metrics directly from daily logs and run evidence; it does not depend on other generated reports.

`SCOPE=source` is the repository invariant; `SCOPE=runtime` checks historical production cleanup. Runtime cleanup is not a PR merge blocker.

## Other operator surfaces

```bash
task movie:generate PLAN=<plan.json>
task movie:status
task analytics:refresh
task asmr:ops
task asmr:publish
task up
task down
task serve
```

Local service availability is environment-dependent; documentation is not runtime evidence.

## Repository map

```text
src/          workflow, audit, release, publish, and operations
config/       domain and channel configuration
runs/         runtime state and evidence
audits/       repository-level verification evidence
artifacts/    generated/supporting artifacts
db/           cross-run data
docs/         maintained standards and ADRs
asmr/         ASMR workflow tooling
Taskfile.yml  canonical operator interface
bun.lock      reproducible dependency graph
```

System audit protocol: [docs/standard/system-audit-protocol.md](docs/standard/system-audit-protocol.md).  
Humanity Observatory standard: [docs/standard/humanity-observatory-audit-standard.md](docs/standard/humanity-observatory-audit-standard.md).

## Completion boundary

A merged PR proves repository acceptance only. A passed product release gate proves local release readiness only. Publication is complete only when remote receipt/read-back evidence verifies the intended channel and visibility.