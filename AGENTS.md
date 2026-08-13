# YT3 Agent Operating Contract

This file is the execution contract for autonomous agents working in this repository.

`README.md` is for human orientation. `AGENTS.md` defines how an agent investigates, changes, verifies, reports, and stops.

## 1. Mission

Operate YT3 as a reproducible, evidence-backed media production system.

Optimize the **execution loop**, not isolated prompt quality:

```text
request
  -> inspect current state
  -> select canonical workline
  -> implement the smallest sufficient change
  -> validate deterministically
  -> inspect evidence
  -> improve the harness when failures recur
  -> stop at a fixed point
```

A task is not complete because code was written. Completion requires evidence that the requested outcome exists in the current repository/runtime state.

## 2. Source-of-Truth Precedence

When sources disagree, use this order:

1. current tool/runtime observations
2. current repository code and configuration
3. `Taskfile.yml` for executable entry points
4. deterministic tests, audits, receipts, and CI results
5. current ADRs and standards under `docs/`
6. `GEMINI.md`
7. `README.md`, `.claude/CLAUDE.md`, memories, issues, and historical prose
8. inference

Never let stale documentation override current executable reality.

Before using a command mentioned in prose, verify that the command exists in `Taskfile.yml` or the current package/tooling configuration.

## 3. Claim Provenance

Every material claim must be one of:

- **VERIFIED** — directly observed with a tool, file read, command result, API response, deterministic artifact, or CI result.
- **OBSERVED** — explicitly supplied by the user or by an authoritative external input.
- **INFERRED** — a hypothesis derived from evidence; label it as inference.
- **UNVERIFIED** — not inspected yet; do not present it as fact.
- **FABRICATED** — forbidden.

Rules:

- Never claim a file, branch, service, model, artifact, upload, publication, or test result without inspecting evidence.
- Never convert “not checked” into “absent”.
- Never convert “command returned” into “outcome succeeded” without checking the relevant postcondition.
- Never report PASS for a verifier that was not actually executed.

## 4. Antigravity Audit Rule

Before concluding that Antigravity is absent, inspect the canonical runtime identifier `agy`.

Mandatory checks when Antigravity is relevant:

1. `which agy`
2. `agy --version`
3. `agy --help`
4. `agy /usage`
5. inspect `Taskfile.yml`, systemd services, tmux launchers, shell scripts, and cron jobs for `agy`

`.agy` is not the canonical runtime identifier. Failure to find `.agy` does not prove that Antigravity is unavailable.

## 5. Canonical Workline Rule

Before creating new work, inspect the current repository state.

Priority:

1. continue the existing canonical PR/branch for the requested outcome
2. otherwise continue the relevant unresolved Issue
3. only then create one new branch and one PR

Do not create parallel branches, duplicate PRs, duplicate implementation paths, or competing state stores for the same outcome.

If an existing branch or PR is clearly superseded, consolidate into one canonical workline and clean up the duplicate when safe.

## 6. Contract Before Change

For non-trivial work, reduce the request to:

- **Contract** — what must change and what must not change
- **Outcome** — the observable state that should exist afterward
- **Acceptance Criteria** — deterministic checks that prove the outcome
- **Evidence** — concrete files, commands, artifacts, receipts, CI runs, or external state
- **Stopping Condition** — the fixed point after which no additional work is required

Do not expand scope merely because adjacent improvements are possible.

## 7. Repository Entry Point

`Taskfile.yml` is the canonical executable interface.

Start with:

```bash
task --list
```

Use defined tasks instead of inventing direct script commands.

For routine code validation, the current canonical tasks are:

```bash
task lint
task test
```

Use narrower domain audits when the change affects their contract, for example:

```bash
task harness:doctor:quick
task harness:doctor
task audit:today
task audit:publish-routing
task audit:no-fallback
task audit:ontology
task stability:ready
task daily:check
```

Do not assume commands documented elsewhere still exist. Verify them against the current Taskfile first.

`task test` and CI currently tolerate a “No tests found” condition. That is not evidence that a changed behavior is covered; add or run a relevant deterministic verifier when behavior materially changes.

## 8. Builder / Auditor Separation

Treat implementation and acceptance as separate roles even when one agent performs both sequentially.

### Builder

The Builder may:

- inspect the repository
- modify code, configuration, tests, prompts, docs, and workflows
- create artifacts required by the task
- run deterministic validation
- open/update the canonical PR

The Builder must not declare success solely from its own implementation intent.

### Auditor

The Auditor must independently check:

- the requested outcome exists
- acceptance criteria are satisfied
- evidence corresponds to the current head SHA/state
- no unrelated regressions or cross-channel contamination were introduced
- publication/external side effects, if requested, have receipts
- cleanup is complete

If implementation and audit use the same evidence-free assumption, the separation has failed.

## 9. Fail-Closed Behavior

Prefer loud, attributable failure over false success.

- Do not hide errors with fallback output that can be mistaken for success.
- Do not catch and suppress failures merely to keep the pipeline green.
- Do not invent substitute data when exact required inputs are missing.
- Do not publish a fallback artifact as though it were the requested artifact.
- A verifier timeout, crash, missing dependency, missing receipt, or ambiguous profile blocks the corresponding acceptance criterion.

Fix root causes. Repeated failures should produce durable harness changes: validation, schemas, routing, retries, evals, observability, or implementation changes.

## 10. Channel Isolation Is a Hard Boundary

Never mix these profiles:

| profile | brand | bucket |
|---|---|---|
| `byosan` | 秒算マネー | `byosan_money` |
| `yawa` | 夜話アーカイブ ASMR | `yawa_archive` |
| `humanity` | 雨晴はうの人類観測所 | `humanity_observatory` |

For Humanity, the expected channel handle is `@humanity_observatory`.

Before any publish operation, verify profile, environment file, bucket, channel identity, artifact identity, and target visibility from current configuration/runtime evidence.

Cross-profile paths, tokens, prompts, voices, palettes, receipts, and publication targets are contamination unless explicitly designed as shared infrastructure.

## 11. Publishing Is an Irreversible Side Effect

Implementation, testing, and local production do not imply authorization to publish.

Publish only when the user request explicitly includes publication or the active canonical task already has an unambiguous publication contract.

Before publication:

1. run the relevant publish-routing/profile audit
2. identify the exact artifact to publish
3. verify the exact target channel/profile
4. verify required zero-trust audits
5. publish through the Taskfile entry point
6. capture the publication receipt (`videoId`, `channelId`, visibility/status)
7. re-read external state when possible

Without a receipt, publication is not VERIFIED.

## 12. Minimal, Reversible Changes

Prefer the smallest change that satisfies the contract.

- preserve existing IDs and provenance unless replacement is required
- avoid speculative abstractions and future-proofing
- remove obsolete helpers introduced by the work
- do not create a second configuration source when one already exists
- do not edit generated artifacts as a substitute for fixing their generator
- do not change unrelated valid branches, issues, assets, or workflows

For destructive or external changes, verify the target twice: once before the action and once after.

## 13. Investigation Before Implementation

Before editing:

1. inspect relevant Issue/PR/branch state
2. inspect the actual implementation and configuration
3. inspect relevant tests/audits
4. inspect CI/workflow definitions if CI is part of acceptance
5. inspect primary/external sources when the task depends on current facts or third-party behavior
6. identify the authoritative state store and generated projections

Do not design from filenames, comments, stale docs, screenshots, or memory alone when inspectable evidence exists.

## 14. Validation Ladder

Use the cheapest deterministic check that can falsify the change, then escalate.

Typical order:

1. targeted unit/schema/contract test
2. targeted domain audit
3. `task lint`
4. `task test`
5. `task harness:doctor:quick` when relevant
6. full harness/domain audit when relevant
7. CI on the exact PR head SHA
8. external postcondition/receipt when the task changes external state

Do not run expensive end-to-end production merely because it exists. Run it only when the acceptance criteria require it.

## 15. Git and PR Protocol

For repository changes:

1. begin from the latest intended base
2. reuse the canonical branch if one exists
3. otherwise create one descriptive branch
4. keep the diff focused on the contract
5. include tests/audits with behavior changes where practical
6. open or update one canonical PR
7. wait for/check CI on the exact head SHA
8. inspect failed jobs rather than retrying blindly
9. merge only when acceptance criteria and repository policy permit
10. close the linked Issue when the outcome is actually complete
11. verify the merged base SHA
12. remove the merged/unneeded work branch when possible

If a host-side safety check rejects a write, re-fetch current state and retry the exact canonical action once. Do not create a duplicate branch/PR as a workaround.

## 16. Cleanup Is Part of Completion

Before final reporting, inspect for residue created by the work:

- temporary files
- debug output
- staging chunks
- abandoned generated intermediates
- obsolete helper workflows/scripts
- superseded PRs
- merged/unneeded branches
- stale issue state

Do not delete unrelated valid work.

If unfinished work must remain, keep exactly one canonical workline with the blocker and next action recorded.

## 17. Secrets, Private Data, and Metadata

- Never expose secrets, OAuth credentials, private tokens, local absolute paths, or private intermediate metadata in public artifacts.
- Treat `.env*`, credentials, receipts, and account/channel identifiers according to their intended visibility.
- Do not copy production secrets into tests, fixtures, docs, screenshots, or prompts.
- User-facing media must not leak internal IDs, temporary filenames, private paths, or agent-only notes unless explicitly required.

## 18. Documentation Discipline

Documentation must describe current behavior, not intended future behavior.

- Human onboarding belongs in `README.md`.
- Agent execution rules belong here.
- Domain standards belong under `docs/standard/` or the relevant ADR.
- Reusable agent skills belong in skill files rather than inflating this root contract.

When documentation conflicts with executable reality, fix the stale documentation or record the discrepancy. Do not silently follow it.

Maintain skill instructions in concise imperative English unless domain-facing content requires Japanese.

## 19. No External Agent Handoff Dependency

Do not make ChatGPT Work, Codex, or another external agent workspace a required step in the repository execution loop.

The canonical loop must remain reproducible from repository state, declared tools, Taskfile entry points, tests/audits, CI, and explicit external-service receipts.

Implementation work may be performed by any capable agent, but acceptance must remain tool- and evidence-based rather than product-dependent.

## 20. Final Report Contract

Report only verified state relevant to the task:

- target Issue/PR/repository URL
- what changed
- tests/audits executed and their result
- PR and commit/merge SHA/URL
- external receipt if external state changed
- cleanup performed
- blocker and exact next action if unfinished

Do not include completion theater, unsupported confidence, or long narratives about work that did not change the outcome.

## 21. Stopping Rule

Stop when all of the following are true:

- requested outcome exists
- acceptance criteria pass
- evidence points to the current final state
- CI/external receipts required by the contract are verified
- linked Issue/PR state is correct
- task-created residue is cleaned up
- no known blocker remains

At that point, further changes are scope expansion, not completion.
