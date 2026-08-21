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

## 4. Canonical workline

Before creating work:

1. continue an existing canonical PR/branch for the requested outcome;
2. otherwise continue the relevant unresolved Issue;
3. only then create one new branch and one PR.

Do not create parallel implementation paths or competing state stores for the same outcome. Superseded work should be consolidated and removed when safe.

## 5. Contract before change

For non-trivial work, identify:

- **Contract** — what must change and what must remain unchanged
- **Outcome** — observable state required afterward
- **Acceptance criteria** — deterministic checks that prove it
- **Evidence** — files, commands, CI runs, receipts, or external state
- **Stopping condition** — the fixed point after which more work is scope expansion

## 6. Repository entry point

`Taskfile.yml` is the operator interface.

```bash
task --list
task setup
task check:fast
task check
```

Use narrower checks when relevant:

```bash
task harness:doctor:quick
task harness:doctor
task audit:today
task audit:publish-routing
task audit:no-fallback
task audit:repo-contract
task daily:last3
task daily:guarantee-status
```

Internal package scripts and `src/scripts/*` files support Taskfile and CI; they are not competing human-facing command surfaces.

## 7. Builder and auditor separation

Treat implementation and acceptance as separate roles even when one agent performs both sequentially.

The builder may inspect, modify, test, and open/update the canonical PR. The auditor independently verifies that the requested outcome exists, evidence belongs to the current head state, required checks pass, unrelated channel state was not contaminated, and cleanup is complete.

Implementation intent is not acceptance evidence.

## 8. Fail closed

Prefer attributable failure over false success.

- Do not hide errors with fallback output that resembles success.
- Do not suppress verifier failures to keep a pipeline green.
- Do not invent substitute data for missing required inputs.
- Do not publish fallback media as the requested artifact.
- Missing dependency, timeout, crash, missing receipt, or ambiguous profile blocks the corresponding criterion.

Repeated failures should produce a durable harness improvement: validation, schema, routing, retry policy, eval, observability, or implementation change.

## 9. Channel isolation

Never mix these profiles:

| profile | brand | bucket |
|---|---|---|
| `byosan` | 秒算マネー | `byosan_money` |
| `yawa` | 夜話アーカイブ ASMR | `yawa_archive` |
| `humanity` | 雨晴はうの人類観測所 | `humanity_observatory` |

For Humanity, the expected channel handle is `@humanity_observatory`.

Before publication, verify profile, environment, bucket, authenticated channel, artifact identity, intended visibility, and required audit evidence.

## 10. Publishing is an irreversible side effect

Implementation and local production do not authorize publication.

Publish only when the user request or active canonical contract explicitly requires it. Use the Taskfile publication path, capture the remote receipt, and read back remote identity/visibility when possible.

Without a remote receipt, publication is not VERIFIED.

## 11. Minimal and reversible changes

Prefer the smallest change that satisfies the contract.

- preserve stable IDs and provenance unless replacement is required
- avoid speculative abstractions
- remove obsolete helpers introduced or exposed by the work
- do not create a second configuration or state source
- fix generators rather than hand-editing their generated output
- do not change unrelated valid work

For destructive or external changes, verify the target before and after the action.

## 12. Investigation before implementation

Before editing, inspect the relevant repository state, implementation/configuration, tests/audits, and CI definitions. Inspect primary external sources when the task depends on current third-party behavior. Identify authoritative state stores and generated projections before changing either.

Do not design from filenames, stale comments, screenshots, memory, or issue prose when inspectable evidence exists.

## 13. Validation ladder

Use the cheapest deterministic check that can falsify the change, then escalate:

1. targeted unit/schema/contract test
2. targeted domain audit
3. `task check:fast`
4. `task check`
5. `task harness:doctor:quick` when relevant
6. full domain/harness audit when relevant
7. CI on the exact PR head SHA
8. external postcondition/receipt for external state changes

Do not run expensive production merely because it exists.

## 14. Git and PR protocol

For repository changes:

1. start from the latest intended base;
2. reuse the canonical branch when one exists;
3. otherwise create one descriptive branch;
4. keep the diff focused;
5. include tests/audits for material behavior changes where practical;
6. open or update one canonical PR;
7. inspect CI on the exact head SHA;
8. diagnose failed jobs rather than retrying blindly;
9. merge only when acceptance criteria and repository policy allow it;
10. verify the merged base and clean up the workline when possible.

If a host-side safety check rejects a write, re-fetch state and retry the same canonical action once. Do not create a duplicate branch/PR as a workaround.

## 15. Cleanup

Before final reporting, inspect for temporary files, debug output, staging chunks, abandoned generated intermediates, one-time workflows/scripts, superseded PRs, and stale task/document references.

If unfinished work must remain, keep one canonical workline with the blocker and exact next action recorded.

## 16. Secrets and private data

Never expose secrets, OAuth credentials, private tokens, local absolute paths, or private intermediate metadata in public artifacts. Do not copy production credentials or account identifiers into tests, docs, prompts, or screenshots.

## 17. Documentation discipline

Documentation describes current behavior, not intended future behavior.

- human onboarding: `README.md`
- agent execution rules: `AGENTS.md`
- standards: `docs/standard/`
- architectural decisions: `docs/adr/`
- reusable agent skills: skill files

`task audit:repo-contract` protects the maintained entry-point documentation from drifting toward missing files or tasks.

## 18. No external-agent dependency

Do not make ChatGPT Work, Codex, or another agent workspace a required execution step. The canonical loop must remain reproducible from repository state, declared tools, Taskfile tasks, tests/audits, CI, and explicit external-service receipts.

## 19. Final report contract

Report only verified state relevant to the task:

- target repository/PR
- what changed
- deterministic checks executed and their result
- commit/PR/merge state
- external receipt if external state changed
- cleanup performed
- blocker and exact next action if unfinished

## 20. Stopping rule

Stop when the requested outcome exists, acceptance evidence belongs to the current final state, required CI/external postconditions are verified, task-created residue is removed, and no known blocker remains. Further work is then scope expansion.
