# YT3 — Auditable Autonomous Media Operations

[![CI](https://github.com/KAFKA2306/yt3/actions/workflows/ci.yml/badge.svg)](https://github.com/KAFKA2306/yt3/actions/workflows/ci.yml)

YT3 is a resumable media-production and YouTube-operations system. Its main concern is not merely generating a video; it is preserving enough state and evidence to answer what happened, what passed, where a run stopped, and which remote channel received an artifact.

The canonical operator interface is `Taskfile.yml`.

```bash
task --list
```

Internal TypeScript and shell files are implementation details. Human and agent operations should use an existing Taskfile task instead of creating a second execution path.

## Operating model

```text
source / event
  -> research
  -> verified facts
  -> script
  -> media production
  -> deterministic/editorial audit
  -> factual-integrity gate
  -> channel-routing verification
  -> private upload
  -> remote read-back
  -> requested visibility
  -> publication receipt
  -> analytics / improvement evidence
```

The core rules are:

- **Facts first.** Material claims retain provenance.
- **Fail closed.** Missing evidence, routing ambiguity, verifier failure, or uncertain remote state does not become fallback success.
- **One operator surface.** `Taskfile.yml` owns executable entry points.
- **Channel identity is a hard boundary.** 秒算マネー, 夜話アーカイブ, and 人類観測所 must not be mixed.
- **State is for resumption; evidence is for proof.** Generated artifacts and attestations do not become competing workflow states.
- **Publication is a separate side effect.** A rendered file is not a YouTube receipt, and a receipt is not remote visibility verification.

## Setup and quality gates

Install the exact dependency graph committed in `bun.lock`, then run the canonical quality gate:

```bash
task setup
task check
```

For a faster deterministic preflight:

```bash
task check:fast
```

`check:fast` includes lint, typecheck, the repository-contract audit, publish-routing audit, and no-fallback audit. The repository-contract audit verifies that local executables referenced by Taskfile/package scripts exist and that the maintained entry-point documentation does not point at missing tasks or files.

Quality-gate ownership is documented in [docs/QUALITY_GATES.md](docs/QUALITY_GATES.md).

## Production

```bash
task loop
task run
task byosan:daily
task run:humanity
task pulse:auto
```

Use explicit run IDs when resuming or publishing. Do not infer a publication target from an unrelated "latest" directory.

Useful status surfaces:

```bash
task audit:today
task daily:last3
task daily:guarantee-status
task movie:status
task audit:publish-routing
task publish:visibility-audit
```

## Channel profiles and publication

| profile | brand | bucket | production / publication |
|---|---|---|---|
| `byosan` | 秒算マネー | `byosan_money` | `task byosan:daily` / `task publish:byosan` |
| `yawa` | 夜話アーカイブ ASMR | `yawa_archive` | `task asmr:publish` / `task publish:yawa` |
| `humanity` | 雨晴はうの人類観測所 | `humanity_observatory` | `task run:humanity` / `task publish:humanity` |

Generic publication requires an explicit profile:

```bash
task publish PROFILE=byosan -- <run-id> [video-path]
task publish PROFILE=yawa -- <run-id> [video-path]
task publish PROFILE=humanity -- <run-id> [video-path]
```

Unknown profiles fail closed. Before upload, YT3 verifies the intended profile against the authenticated YouTube channel. If a prior upload intent has uncertain remote commit state, the publisher stops rather than issuing another upload blindly.

## Publication state

Do not compress these stages into one `done` flag:

```text
SCRIPT_DONE
MEDIA_GENERATED
AUDIT_PASSED
FACTUAL_INTEGRITY_PASS
ROUTING_VERIFIED
PRIVATE_UPLOADED
REMOTE_VERIFIED
VISIBILITY_APPLIED
VISIBILITY_VERIFIED
```

`runs/<domain>/<run>/publish/state.json` is the canonical publication state. Thumbnail, caption, visibility attestations, and `receipt.json` are evidence attached to that state rather than independent state machines.

## Evidence layout

```text
runs/<domain>/<run>/state.json             production state
runs/<domain>/<run>/audit/                 audit results and raw evidence
runs/<domain>/<run>/publish/state.json     canonical publication state
runs/<domain>/<run>/publish/*.json         publication attestations and receipt
runs/<domain>/<run>/run_evidence.json      cross-stage run evidence
db/                                         cross-run evolution/audit data
docs/                                       maintained standards and ADRs
```

The system audit protocol is [docs/standard/system-audit-protocol.md](docs/standard/system-audit-protocol.md). Humanity Observatory has a separate domain standard at [docs/standard/humanity-observatory-audit-standard.md](docs/standard/humanity-observatory-audit-standard.md).

## Operational entry points

Production:

```bash
task loop
task run
task run:humanity
task byosan:daily
task pulse:auto
```

Publication:

```bash
task publish:byosan -- <run-id>
task publish:yawa -- <run-id>
task publish:humanity -- <run-id>
task publish:nlm
task asmr:publish
```

Audit and status:

```bash
task audit:today
task audit:publish-routing
task audit:byosan-money
task audit:no-fallback
task audit:repo-contract
task publish:visibility-audit
task daily:guarantee-status
task daily:last3
task daily:report
task improve:report
```

Local services:

```bash
task bootstrap
task up
task down
```

Local service availability is environment-dependent; documentation is not evidence that a service is running.

## Repository map

```text
src/          production, audit, publish, and workflow implementation
config/       channel, environment, and domain configuration
runs/         runtime state and evidence
audits/       repository-level verification evidence
artifacts/    generated/supporting artifacts
db/           cross-run evolution and audit data
docs/         maintained standards and ADRs
asmr/         ASMR workflow and archive tooling
Taskfile.yml  canonical operator interface
AGENTS.md     repository execution contract for agents
GEMINI.md     runtime epistemic contract
bun.lock      reproducible dependency graph
```

## Completion boundary

YT3 is complete only to the highest stage for which current evidence exists. A render does not imply publication, and an upload ID does not imply requested visibility.

For any run, the operator should be able to answer:

- What facts were used?
- Which artifacts were generated?
- Which checks passed or blocked progression?
- Which channel was intended and authenticated?
- Was a remote video already created?
- What is its current visibility?
- From which exact state should the next execution resume?
