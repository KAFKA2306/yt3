# YT3 Agent Operating Contract

This file defines how autonomous agents inspect, change, verify, and report work in this repository. `README.md` is human orientation; `Taskfile.yml` is the canonical executable interface.

## 1. Mission

Operate YT3 as a reproducible, evidence-backed media production system.

```text
request
  -> inspect current state
  -> select one canonical workline
  -> implement the smallest sufficient change
  -> validate deterministically
  -> inspect evidence
  -> improve the harness when failures recur
  -> stop at a fixed point
```

Code written is not completion. Completion requires evidence that the requested outcome exists in the current repository/runtime state.

## 2. Source-of-truth precedence

When sources disagree, use this order:

1. current tool/runtime observations
2. current repository code and configuration
3. `Taskfile.yml` executable entry points
4. deterministic tests, audits, receipts, and CI
5. maintained ADRs and standards under `docs/`
6. `GEMINI.md`
7. README, local agent notes, issues, and historical prose
8. inference

Never let stale prose override current executable reality. Before using a documented command, verify that its Taskfile task still exists.

## 3. Claim provenance

Material claims must be classified as:

- **VERIFIED** — directly observed with a tool, file read, deterministic artifact, API response, or CI result
- **OBSERVED** — explicit user or authoritative external input
- **INFERRED** — a conclusion derived from evidence and labeled as inference
- **UNVERIFIED** — not inspected yet
- **FABRICATED** — forbidden

Do not convert “not checked” into “absent”, or “command returned” into “outcome succeeded”. Never report PASS for a verifier that was not executed.

## 4. Antigravity runtime evidence

When Antigravity is relevant, `agy` is the canonical runtime identifier. Before claiming it is absent or unavailable, inspect `which agy`, `agy --version`, `agy --help`, and `agy /usage`, then inspect Taskfile/systemd/tmux/shell/cron integration as applicable. Absence of a `.agy` path is not evidence that the runtime is absent.

## 5. Canonical workline

Before creating work:

1. continue an existing canonical PR/branch for the requested outcome;
2. otherwise continue the relevant unresolved Issue;
3. only then create one new branch and one PR.

Do not create parallel implementation paths or competing state stores for the same outcome. Superseded work should be consolidated and removed when safe.

## 6. Contract before change

For non-trivial work, identify:

- **Contract** — what must change and what must remain unchanged
- **Outcome** — observable state required afterward
- **Acceptance criteria** — deterministic checks that prove it
- **Evidence** — files, commands, CI runs, receipts, or external state
- **Stopping condition** — the fixed point after which more work is scope expansion

## 7. Repository entry point

`Taskfile.yml` is the operator interface.

```bash
task --list
task setup
task check:merge:fast
task check:merge
```

Use narrower checks when relevant:

```bash
task harness:doctor:quick
task harness:doctor
task audit:today
task audit:publish-routing
task audit:no-fallback:source
task audit:no-fallback:runtime
task audit:repo-contract
task daily:last3
task daily:guarantee-status
```

Internal package scripts and `src/scripts/*` files support Taskfile and CI; they are not competing human-facing command surfaces.

## 8. Merge acceptance and product release are independent

Never use one gate as evidence for the other.

### PR merge gate

`task check:merge` decides whether the repository revision is acceptable to merge. It is restricted to repository/source state and deterministic tests. It must not require production credentials, a concrete `RUN_ID`, current YouTube state, or historical runtime cleanup receipts.

A green CI run means **merge criteria passed for that commit**. It does not mean a video is ready or authorized for publication.

### Product release gate

`task release:check PROFILE=<profile> -- <run-id> [video-path]` decides whether one concrete run/artifact is locally ready to cross the publication boundary. It evaluates run/profile alignment, artifact identity, factual-integrity evidence, fallback prohibition, and canonical publication conflict state.

A passing release preflight does not mean publication occurred. Remote channel identity and post-publication visibility still require separate evidence.

## 9. Builder and auditor separation

Treat implementation and acceptance as separate roles even when one agent performs both sequentially.

The builder may inspect, modify, test, and open/update the canonical PR. The auditor independently verifies that the requested outcome exists, evidence belongs to the current head state, required checks pass, unrelated channel state was not contaminated, and cleanup is complete.

Implementation intent is not acceptance evidence.

## 10. Fail closed

Prefer attributable failure over false success.

- Do not hide errors with fallback output that resembles success.
- Do not suppress verifier failures to keep a pipeline green.
- Do not invent substitute data for missing required inputs.
- Do not publish fallback media as the requested artifact.
- Missing dependency, timeout, crash, missing receipt, or ambiguous profile blocks the corresponding criterion.

Repeated failures should produce a durable harness improvement: validation, schema, routing, retry policy, eval, observability, or implementation change.

## 11. Channel isolation

Never mix these profiles:

| profile | brand | bucket |
|---|---|---|
| `byosan` | 秒算マネー | `byosan_money` |
| `yawa` | 夜話アーカイブ ASMR | `yawa_archive` |
| `humanity` | 雨晴はうの人類観測所 | `humanity_observatory` |

For Humanity, the expected channel handle is `@humanity_observatory`.

Before publication, verify profile, environment, bucket, authenticated channel, artifact identity, intended visibility, and required audit evidence. Static profile routing is a merge-time repository invariant; concrete run/channel identity is a release-time invariant.

## 12. Publishing is an irreversible side effect

Implementation and local production do not authorize publication. A merged PR does not authorize publication either.

Publish only when the user request or active canonical contract explicitly requires it. Use the Taskfile publication path. The canonical YouTube publisher executes the product release gate before OAuth/channel verification and remote publication work.

Capture the remote receipt and read back remote identity/visibility when possible. Without a remote receipt, publication is not VERIFIED.

## 13. Minimal and reversible changes

Prefer the smallest change that satisfies the contract.

- preserve stable IDs and provenance unless replacement is required
- avoid speculative abstractions
- remove obsolete helpers introduced or exposed by the work
- do not create a second configuration or state source
- fix generators rather than hand-editing their generated output
- do not change unrelated valid work

For destructive or external changes, verify the target before and after the action.

## 14. Investigation before implementation

Before editing, inspect the relevant repository state, implementation/configuration, tests/audits, and CI definitions. Inspect primary external sources when the task depends on current third-party behavior. Identify authoritative state stores and generated projections before changing either.

Do not design from filenames, stale comments, screenshots, memory, or issue prose when inspectable evidence exists.

## 15. Validation ladder

For repository changes, use the cheapest deterministic check that can falsify the change, then escalate:

1. targeted unit/schema/contract test
2. targeted domain audit
3. `task check:merge:fast`
4. `task check:merge`
5. `task harness:doctor:quick` when relevant
6. full domain/harness audit when relevant
7. CI on the exact PR head SHA

For a requested product release, start a separate release ladder only after the repository revision is known:

1. `task release:check PROFILE=<profile> -- <run-id> [video-path]`
2. authenticated channel verification
3. remote publication action when explicitly authorized
4. remote receipt/read-back/visibility evidence

Do not run production release checks merely to prove a PR is mergeable, and do not treat a merge-gate PASS as product release evidence.

## 16. Git and PR protocol

For repository changes:

1. start from the latest intended base;
2. reuse the canonical branch if one exists;
3. otherwise create one descriptive branch;
4. keep the diff focused;
5. include tests/audits for material behavior changes where practical;
6. open or update one canonical PR;
7. inspect CI on the exact head SHA;
8. diagnose failed jobs rather than retrying blindly;
9. merge only when merge acceptance criteria and repository policy allow it;
10. verify the merged base and clean up the workline when possible.

Product release readiness is not a condition for merging a code PR unless the PR contract explicitly changes a production artifact and requires that external postcondition.

If a host-side safety check rejects a write, re-fetch state and retry the same canonical action once. Do not create a duplicate branch/PR as a workaround.

## 17. Cleanup

Before final reporting, inspect for temporary files, debug output, staging chunks, abandoned generated intermediates, one-time workflows/scripts, superseded PRs, and stale task/document references.

If unfinished work must remain, keep one canonical workline with the blocker and exact next action recorded.

## 18. Secrets and private data

Never expose secrets, OAuth credentials, private tokens, local absolute paths, or private intermediate metadata in public artifacts. Do not copy production credentials or account identifiers into tests, docs, prompts, or screenshots.

## 19. Documentation discipline

Documentation describes current behavior, not intended future behavior.

- human onboarding: `README.md`
- agent execution rules: `AGENTS.md`
- gate ownership: `docs/QUALITY_GATES.md`
- standards: `docs/standard/`
- architectural decisions: `docs/adr/`
- reusable agent skills: skill files

`task audit:repo-contract` protects the maintained entry-point documentation from drifting toward missing files or tasks.

## 20. No external-agent dependency

Do not make ChatGPT Work, Codex, or another agent workspace a required execution step. The canonical loop must remain reproducible from repository state, declared tools, Taskfile tasks, tests/audits, CI, and explicit external-service receipts.

## 21. Final report contract

Report only verified state relevant to the task:

- target repository/PR
- what changed
- deterministic checks executed and their result
- commit/PR/merge state
- product release gate result only when a concrete run was actually checked
- external receipt only if external state changed
- cleanup performed
- blocker and exact next action if unfinished

## 22. Stopping rule

Stop when the requested outcome exists, acceptance evidence belongs to the current final state, required CI/external postconditions are verified, task-created residue is removed, and no known blocker remains. Further work is then scope expansion.
