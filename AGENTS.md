# YT3 Agent Operating Contract

`AGENTS.md` defines repository-wide rules for autonomous work. `README.md` is human orientation; `Taskfile.yml` is the canonical executable interface.

The objective is not to produce plausible changes. It is to leave YT3 in a verified state with the smallest sufficient diff, one canonical workline, and evidence that belongs to the final state.

## 1. Evidence decides current state

Use the most direct current evidence available. When sources conflict, prefer:

1. current runtime/tool observations
2. current repository code and configuration
3. `Taskfile.yml` and executable checks
4. deterministic tests, audits, receipts, and CI
5. maintained ADRs and standards under `docs/`
6. `GEMINI.md`
7. README, issues, local agent notes, and historical prose
8. inference

Do not let stale prose override executable reality. Verify a documented task or path before relying on it.

For material claims, distinguish:

- **VERIFIED** — directly observed from a tool, file, deterministic artifact, API response, receipt, or CI result
- **OBSERVED** — explicitly supplied by the user or an authoritative external source
- **INFERRED** — derived from evidence and identified as inference
- **UNVERIFIED** — not inspected yet
- **FABRICATED** — forbidden

“Not checked” is not “absent”. A command returning is not proof that its intended postcondition exists. Never report a verifier as passing unless it actually ran against the state being reported.

## 2. Define the contract before non-trivial changes

Identify five things before editing:

- **Contract** — what must change and what must remain unchanged
- **Outcome** — the observable state required afterward
- **Acceptance** — deterministic checks that can falsify the change
- **Evidence** — files, commands, CI runs, receipts, or external read-backs that prove the outcome
- **Stop condition** — the fixed point after which additional work is scope expansion

Prefer the smallest reversible change that satisfies this contract.

## 3. Keep one canonical workline

Before creating work:

1. continue the existing PR/branch for the requested outcome;
2. otherwise continue the relevant unresolved Issue;
3. only then create one new branch and one PR.

Do not create parallel implementation paths, duplicate PRs, or competing state stores for the same outcome. Consolidate superseded work when safe.

If a host-side safety check rejects a write, re-fetch current state and retry the same canonical action once. Do not bypass the rejection by creating another branch or PR.

## 4. Use Taskfile as the operator interface

Start with:

```bash
task --list
task setup
task check:merge:fast
task check:merge
```

Relevant narrower checks include:

```bash
task audit:repo-contract
task audit:publish-routing
task audit:no-fallback:source
task audit:no-fallback:runtime
task harness:doctor:quick
task harness:doctor
task audit:today
task daily:last3
task daily:guarantee-status
```

Internal package scripts and `src/scripts/*` support Taskfile and CI. They are not a second human-facing command surface unless the repository explicitly makes them one.

## 5. PR merge and product release are separate gates

Never use one gate as evidence for the other.

### Merge gate

`task check:merge` decides whether a repository revision is acceptable to merge. It is limited to repository/source invariants and deterministic tests. It must not depend on production credentials, a concrete `RUN_ID`, current YouTube state, or historical runtime cleanup receipts.

A green CI run proves only that merge criteria passed for that commit.

### Product release gate

`task release:check PROFILE=<profile> -- <run-id> [video-path]` evaluates one concrete run/artifact before it may cross the publication boundary. It checks run/profile alignment, artifact identity, factual-integrity evidence, fallback prohibition, and publication-conflict state.

A passing release check does not prove publication occurred. Remote channel identity, publication receipt, and final visibility require separate evidence.

Do not run product-release checks merely to prove a code PR is mergeable. Do not treat a merge-gate PASS as release evidence.

## 6. Fail closed at real boundaries

Prefer attributable failure over false success.

- do not hide errors behind fallback output that resembles success
- do not suppress verifier failures to keep pipelines green
- do not invent substitute data for required missing inputs
- do not publish fallback media as the requested artifact
- missing dependencies, timeouts, crashes, missing receipts, or ambiguous profiles block only the criterion they prevent proving

When a failure pattern repeats, improve the durable harness: validation, schema, routing, retry policy, eval, observability, or implementation. Do not accumulate ad-hoc recovery paths.

## 7. Preserve channel and publication isolation

These profiles are distinct products:

| profile | brand | bucket |
|---|---|---|
| `byosan` | 秒算マネー | `byosan_money` |
| `yawa` | 夜話アーカイブ ASMR | `yawa_archive` |
| `humanity` | 雨晴はうの人類観測所 | `humanity_observatory` |

For Humanity, the expected channel handle is `@humanity_observatory`.

Static routing is a merge-time repository invariant. Concrete run, artifact, authenticated channel, intended visibility, and publication evidence are release-time invariants.

Publishing is an irreversible external side effect. A code change, green CI, merged PR, produced video, or passing release preflight does not by itself authorize publication. Publish only when the active user request or canonical contract explicitly requires it, through the Taskfile publication path. Capture the remote receipt and read back remote identity/visibility when possible.

Without a remote receipt, publication is not VERIFIED.

## 8. Change source, not projections

Before editing, inspect the relevant implementation, configuration, tests/audits, CI definitions, and authoritative state stores. When current third-party behavior matters, inspect primary external evidence.

Then:

- preserve stable IDs and provenance unless replacement is required
- fix generators rather than hand-editing generated output
- avoid speculative abstractions and duplicate configuration/state sources
- remove obsolete helpers exposed by the change when safe
- do not alter unrelated valid work
- verify destructive or external targets before and after mutation

Do not design from filenames, screenshots, stale comments, memory, or issue prose when direct evidence is available.

## 9. Validate from cheap to expensive

For repository changes, escalate only as needed:

1. targeted unit/schema/contract test
2. targeted domain audit
3. `task check:merge:fast`
4. `task check:merge`
5. `task harness:doctor:quick` when relevant
6. full domain/harness audit when relevant
7. CI on the exact PR head SHA

For an explicitly requested product release, use a separate ladder after the repository revision is known:

1. `task release:check PROFILE=<profile> -- <run-id> [video-path]`
2. authenticated channel verification
3. remote publication action when authorized
4. remote receipt/read-back/visibility verification

Implementation intent is not acceptance evidence. Treat builder and auditor as separate roles even when the same agent performs them sequentially.

## 10. Git, CI, and cleanup

For repository changes:

1. start from the latest intended base and canonical branch;
2. keep the diff focused;
3. add or update deterministic tests/audits for material behavior changes where practical;
4. update the canonical PR rather than opening a competing one;
5. inspect CI for the exact head SHA;
6. diagnose failures rather than retrying blindly;
7. merge only when merge acceptance criteria and repository policy allow it;
8. after merge, verify the intended base state and remove task-created residue when possible.

Before final reporting, inspect for temporary files, debug output, staging chunks, abandoned intermediates, one-time workflows/scripts, superseded worklines, and stale task/document references.

If unfinished work must remain, leave exactly one canonical workline with the blocker and next executable action recorded.

## 11. Documentation and tooling boundaries

Documentation describes current behavior, not intended future behavior.

- human onboarding: `README.md`
- repository-wide agent rules: `AGENTS.md`
- gate ownership: `docs/QUALITY_GATES.md`
- standards: `docs/standard/`
- architectural decisions: `docs/adr/`
- reusable agent procedures: skill files

`task audit:repo-contract` protects maintained entry-point documentation from drifting toward missing tasks or files.

Agent-local accelerators such as prompt frameworks, editor integrations, LSPs, or external agent workspaces are optional implementation aids. They are not repository dependencies unless an executable repository workflow explicitly requires them. Do not add or restore a tool solely to satisfy one agent's preferred environment.

Do not make ChatGPT Work, Codex, or another external agent workspace a required execution step. The canonical loop must remain reproducible from repository state, declared dependencies, Taskfile tasks, tests/audits, CI, and explicit external-service receipts.

## 12. Secrets, completion, and reporting

Never expose secrets, OAuth credentials, private tokens, local absolute paths, or private intermediate metadata in public artifacts. Do not copy production credentials or account identifiers into tests, docs, prompts, or screenshots.

Work is complete only when:

- the requested outcome exists in the final state;
- acceptance evidence belongs to that final state;
- required CI and external postconditions are verified;
- task-created residue is removed or intentionally retained on the canonical workline;
- no known blocker remains.

Report only verified state relevant to the task:

- repository and canonical PR/workline
- what changed
- deterministic checks actually executed and their results
- commit/PR/merge state
- product release result only when a concrete run was checked
- external receipt only when external state changed
- cleanup performed
- blocker and exact next action if unfinished

Stop at this fixed point. Further work is scope expansion.
