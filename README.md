# YT3 — Auditable Autonomous Media Operations

[![CI](https://github.com/KAFKA2306/yt3/actions/workflows/ci.yml/badge.svg)](https://github.com/KAFKA2306/yt3/actions/workflows/ci.yml)

YT3 is for a media operator who wants to automate research, production and YouTube operations **without losing track of what is true, what was generated, what passed audit, where a failed run stopped, or which channel received the result**.

The recurring production friction is not “how do I generate one more video?” It is:

- a run failed and the restart point is unclear;
- a media file exists but nobody knows whether it passed audit;
- a publish call returned, but the remote channel/visibility was not verified;
- generated title/thumbnail/script claims drift from their evidence;
- automation retries and accidentally creates a second remote upload;
- historical/legacy files get mistaken for active production state.

YT3 addresses those problems by keeping production state and evidence explicit. **Generated, audited, publishable, uploaded and remotely verified are different states.**

The canonical executable front door is `Taskfile.yml`:

```bash
task --list
```

## Vision

Turn AI media production from “a chain that can generate content” into a **resumable, observable operation whose factual basis, channel routing, artifacts and publication result can be explained after the run**.

Full autonomy is not claimed when an external prerequisite is missing. OAuth consent, unavailable providers, policy restrictions or failed evidence gates remain visible blockers rather than being hidden behind fallback output.

## Design philosophy

- **Facts first. Structure later.** Start from concrete events, people, companies, numbers and source differences.
- **Every material claim has provenance.** VERIFIED / OBSERVED / INFERRED / UNVERIFIED are not interchangeable.
- **Research is not production.** Only validated facts cross the research → script boundary.
- **Fail closed.** Timeout, verifier failure, evidence gaps or routing mismatch do not become fallback success.
- **Channel identity is a security boundary.** 秒算マネー / 夜話アーカイブ / 人類観測所 must not be mixed.
- **One executable front door.** Taskfile commands are the operator interface; internal scripts do not become competing operational paths.
- **Artifact success is not publication success.** A video file is not a YouTube receipt and a receipt is not remote visibility verification.
- **State is for resumption; evidence is for proof.** Do not make every attestation file into a competing workflow state.

The internal “Zero-Fat”, Crash-Driven and Zero-Trust rules exist to support these UX properties: fewer ambiguous paths, visible failure boundaries and reproducible evidence.

## Why / difference

Typical AI-video workflows focus on connecting LLM, TTS, image/video generation and editing tools. YT3 focuses on the operational boundary after those tools exist:

```text
source / event
  → research
  → verified facts
  → script
  → media production
  → deterministic/editorial audit
  → factual-integrity gate
  → channel-routing verification
  → private upload
  → remote read-back
  → requested visibility
  → publication receipt
  → visibility audit
  → analytics / improvement evidence
```

A later stage cannot retroactively make an earlier unverified assumption true.

## Start or resume without guessing

### 1. See the available operations

```bash
task --list
```

### 2. Verify the repository before production

```bash
bun run setup
bun run check
```

The quality-gate ownership and hook policy are documented in [docs/QUALITY_GATES.md](docs/QUALITY_GATES.md).

### 3. Start a normal production path

```bash
task loop
task run
task byosan:daily
task run:humanity
```

### 4. Resume or inspect an existing run

Do not infer a publish target from “latest”. Use an explicit run ID and inspect its evidence first.

Useful operator surfaces:

```bash
task audit:today
task daily:last3
task daily:guarantee-status
task movie:status
task audit:publish-routing
task publish:visibility-audit
```

For YouTube publication, the destination profile is explicit:

```bash
task publish PROFILE=byosan -- <run-id> [video-path]
task publish PROFILE=yawa -- <run-id> [video-path]
task publish PROFILE=humanity -- <run-id> [video-path]
```

If a run already has remote publication evidence, canonical publication state is checked before another upload is attempted.

## Production states

Do not compress these into one “done” flag:

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

YouTube publication uses `publish/state.json` as the canonical publication state. Files such as thumbnail/caption/visibility attestations and `receipt.json` remain evidence; they are not independent competing state machines.

## Three channel identities

| profile | brand | bucket | canonical task |
|---|---|---|---|
| `byosan` | 秒算マネー | `byosan_money` | `task byosan:daily` / `task publish:byosan` |
| `yawa` | 夜話アーカイブ ASMR | `yawa_archive` | `task publish:yawa` / `task asmr:publish` |
| `humanity` | 雨晴はうの人類観測所 | `humanity_observatory` | `task run:humanity` / `task publish:humanity` |

Unknown profiles fail. Channel identity is verified against the authenticated YouTube account before upload.

## Publication contract

A successful API call is not publication completion. The path requires, as applicable:

1. content artifact exists;
2. artifact/source identity is known;
3. content/audit evidence passes;
4. factual-integrity evidence passes before non-private publication;
5. intended profile/bucket is explicit;
6. authenticated channel identity matches intent;
7. upload is staged private;
8. remote video identity is read back;
9. thumbnail/caption/schedule operations are separately attested;
10. requested visibility is applied and re-read;
11. receipt and canonical publication state remain traceable to the run.

If a previous upload intent has an uncertain remote commit, YT3 stops instead of issuing another `videos.insert` blindly.

## Claim provenance

`GEMINI.md` defines the runtime epistemic contract. The important distinction is that claims are not allowed to become stronger simply because they were used in a script.

- `VERIFIED` — directly checked evidence
- `OBSERVED` — explicit input/rule
- `INFERRED` — conclusion from observations, presented as inference
- `UNVERIFIED` — not confirmed
- `FABRICATED` — forbidden

Raw evidence outranks an agent’s prose explanation.

## Audit and evidence model

Deterministic checks are preferred where possible, including media existence/shape, routing, receipt identity, publication state and policy constraints. Bounded probabilistic checks may add editorial evidence, but cannot replace deterministic validity gates.

Important evidence locations:

```text
runs/<domain>/<run>/state.json             run state
runs/<domain>/<run>/audit/                 audit results/raw evidence
runs/<domain>/<run>/publish/state.json     canonical publication state
runs/<domain>/<run>/publish/*.json         publication attestations/receipt
runs/<domain>/<run>/run_evidence.json      cross-stage run evidence
db/                                         evolution/audit trace data
docs/                                       standards, ADRs and protocols
```

### How these make resumption possible

- `runs/` tells the operator **which concrete run** is being resumed; active tools do not need to guess from unrelated legacy folders.
- `state.json` records production inputs/outputs that later stages consume.
- `audit/` explains **why a run may or may not advance**.
- `publish/state.json` prevents a remote upload from being repeated merely because a later thumbnail/caption/visibility step failed.
- `receipt.json` and visibility attestations prove what happened remotely; they do not replace canonical state.
- `db/` and improvement artifacts are for cross-run analysis, not for silently changing the truth state of an individual run.
- `docs/` defines the rules used to interpret these artifacts so a future session can resume without reconstructing policy from memory.

Detailed audit protocol: [docs/AUDIT_PROTOCOL.md](docs/AUDIT_PROTOCOL.md)

Humanity Observatory standard: [docs/standard/humanity-observatory-audit-standard.md](docs/standard/humanity-observatory-audit-standard.md)

## Operational entry points

### Production

```bash
task loop
task run
task run:humanity
task byosan:daily
task pulse:auto
```

### Publish

```bash
task publish PROFILE=byosan -- <run-id>
task publish:byosan -- <run-id>
task publish:yawa -- <run-id>
task publish:humanity -- <run-id>
task publish:nlm
task asmr:publish
```

### Audit / status

```bash
task audit:today
task audit:publish-routing
task audit:byosan-money
task audit:no-fallback
task audit:ontology
task publish:visibility-audit
task daily:guarantee-status
task daily:last3
task daily:report
task improve:report
```

### Quality

```bash
bun run check:fast
bun run check
```

### Local services

```bash
task bootstrap
task up
task down
```

Local service availability is environment-dependent; README text is not evidence that the services are running.

## Repository map

```text
src/          production / audit / publish logic
config/       channel / environment / domain configuration
runs/         run state and evidence
audits/       repository-level verification evidence
artifacts/    generated/supporting artifacts
db/           evolution and audit trace data
docs/         ADRs, standards and protocols
asmr/         ASMR workflow
Taskfile.yml  canonical operator entry point
GEMINI.md     strict autonomous runtime contract
AGENTS.md     agent working rules
```

## Completion boundary

YT3 is complete for a run only to the highest stage for which evidence exists. It does not report `PUBLISHED` because a render exists, and it does not report `VISIBILITY_VERIFIED` because an upload API returned an ID.

The system’s useful outcome is not the number of agents or generated videos. It is that after automation runs, a person can still answer:

- What facts were used?
- Which artifacts were generated?
- Which checks passed or blocked progression?
- Which channel was intended and authenticated?
- Was a remote video already created?
- What is its current visibility?
- From which exact state should the next run resume?
