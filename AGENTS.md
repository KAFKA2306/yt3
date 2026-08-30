# YT3 Agent Operating Contract

`Taskfile.yml` is the canonical executable interface. `README.md` is human orientation. This file defines repository-wide rules for autonomous work.

The objective is to leave YT3 in a verified state with the smallest sufficient diff, one canonical workline, and evidence that belongs to the final state.

## 1. Evidence decides current state

Prefer, in order:

1. current runtime/tool observations
2. current repository code/configuration
3. `Taskfile.yml` and executable checks
4. deterministic tests, audits, receipts, and exact-head CI
5. maintained standards/ADRs
6. prose and historical context
7. inference

Use these labels when material:

- **VERIFIED** — directly observed from code, tools, deterministic evidence, API/read-back, or CI
- **OBSERVED** — explicitly supplied by the user or an authoritative source
- **INFERRED** — derived from evidence
- **UNVERIFIED** — required evidence was not obtained

Never turn “not checked” into “absent”, and never report a verifier as passing unless it ran against the state being reported.

## 2. Keep one canonical workline

Before editing:

1. continue the existing PR/branch for the requested outcome;
2. otherwise continue the relevant unresolved Issue;
3. only then create one branch and one PR.

Do not create duplicate implementation paths, state stores, PRs, or fallback workflows for the same outcome. Prefer deletion and consolidation over compatibility layers when the old path is no longer required.

For non-trivial changes define:

- contract
- observable outcome
- deterministic acceptance checks
- evidence
- stop condition

## 3. Use the canonical operator surface

Start with:

```bash
task --list
task setup
task check:merge:fast
task check:merge
```

Useful targeted checks:

```bash
task audit:repo-contract
task audit:publish-routing
task audit:no-fallback SCOPE=source
task audit:no-fallback SCOPE=runtime
task audit:today
task stability:report
```

Internal `src/scripts/*` and package scripts support Taskfile/CI; they are not a second human-facing interface unless explicitly documented as one.

### Production execution requests are runtime operations

An explicit request to run/start/`動かす` a production path is not satisfied by repository validation alone. It means executing the canonical Taskfile command on the target runtime.

- if authorized target-host execution capability is available, use it rather than stopping at CI or repository evidence;
- CI, unit tests, mocks, simulations, and `DRY_RUN` must never be reported as the requested production execution;
- never create an ad-hoc GitHub Actions workflow merely to bypass the target-host boundary;
- if the current tool context cannot execute on the target host, report the runtime result as **UNVERIFIED** and explicitly state that the production command was not executed;
- repository acceptance may be VERIFIED while product/runtime/publication remains separately UNVERIFIED.

For 秒算マネー, `task byosan:prepare DATE=YYYY-MM-DD` is preparation-only, `task byosan:daily` is the full daily production path, and explicit publication follows the authorization boundary defined below.

## 4. Repository, product, and publication are separate verdicts

| evidence | proves | does not prove |
|---|---|---|
| `task check:merge` / green exact-head CI | repository revision satisfies merge criteria | product works, is release-ready, or was published |
| target machine/service unavailable | target-specific criterion is UNVERIFIED | repository is unmergeable |
| deterministic test/mock/simulation | tested repository contract holds | real target behavior occurred |
| `task release:check PROFILE=<profile> -- <run-id> [video-path]` | exact artifact passes local release preflight | remote publication occurred |
| remote receipt/read-back | specified external postcondition occurred | source quality or mergeability |

The merge gate must not depend on production credentials, a concrete run, current YouTube state, historical runtime cleanup, or a particular production machine.

Product criteria that require a real target remain **UNVERIFIED** until tested there. Do not downgrade repository mergeability because the target is unavailable, and do not upgrade product status because CI is green.

## 5. Fail closed at real boundaries

- do not hide errors behind fallback output that resembles success
- do not invent substitute data for required missing inputs
- do not suppress verifier failures to keep pipelines green
- do not publish fallback media as the requested artifact
- ambiguous profile, missing evidence, missing receipt, uncertain remote state, or failed read-back blocks only the criterion it prevents proving

These YouTube profiles are distinct products:

| profile | brand | bucket |
|---|---|---|
| `byosan` | 秒算マネー | `byosan_money` |
| `yawa` | 夜話アーカイブ ASMR | `yawa_archive` |
| `humanity` | 雨晴はうの人類観測所 | `humanity_observatory` |

Publication is an irreversible external side effect. Use only the canonical Taskfile publication path, with an explicit profile and run. A code change, merge, rendered video, or local release preflight does not authorize or prove publication.

Without remote receipt/read-back evidence, publication is not VERIFIED.

### 秒算マネー local-agent publish-ready handoff

When the requested outcome is “leave 秒算マネー ready to publish and hand it to a local agent”, the local agent must use this exact boundary:

```bash
git pull
task setup
task byosan:prepare DATE=YYYY-MM-DD
```

Rules:

1. `DATE` must be explicitly supplied in `YYYY-MM-DD` form. Do not infer “today” or substitute another date.
2. `task byosan:prepare` is the canonical preparation path. It performs research, production, audit, and the product release gate, but must not perform the external YouTube publication side effect.
3. If preparation or the release gate fails, stop. Do not bypass, weaken, retry around, or replace the failed gate with manual publication.
4. A run is **publish-ready** only when the command succeeds and emits all of the following evidence for the same run:
   - `[product-release-gate] PASS ... artifact_sha256=<sha256>`
   - `PUBLISH_READY_RUN=<run-id>`
   - `PUBLISH_COMMAND=task publish PROFILE=byosan -- <run-id>`
5. Record the exact run id, artifact SHA-256, and printed publish command in the governing Issue or requested handoff surface, then stop. The local agent must not execute `PUBLISH_COMMAND` unless the user separately and explicitly authorizes publication.
6. After explicit publication authorization, use only the exact canonical `task publish PROFILE=byosan -- <run-id>` path. Publication becomes VERIFIED only after remote receipt/read-back/visibility evidence is obtained.

The stop condition for a preparation-only handoff is therefore: exact artifact generated, product release gate PASS, exact publish command recorded, and no remote publication performed.

## 6. Change source, then validate

Inspect implementation, configuration, tests/audits, CI, and authoritative state before editing. Fix the source of truth rather than generated projections or stale documentation.

Prefer:

- one source of truth
- typed boundaries and parse-once validation
- generators over hand-edited generated output
- deletion of obsolete helpers exposed by the change
- no speculative abstractions
- no duplicate configuration/state

Repository validation ladder:

1. targeted unit/schema/contract test when useful
2. targeted domain audit
3. `task check:merge:fast`
4. `task check:merge`
5. exact-head GitHub CI

For an explicitly requested product release, use a separate ladder after repository acceptance:

1. `task release:check PROFILE=<profile> -- <run-id> [video-path]`
2. required target/runtime qualification
3. authenticated channel verification
4. authorized remote side effect
5. remote receipt/read-back/visibility verification

Implementation intent is not acceptance evidence.

## 7. Git, cleanup, and reporting

For repository changes:

1. start from the intended current base;
2. keep the diff focused;
3. update the canonical PR rather than creating a competing one;
4. diagnose CI failures instead of retrying blindly;
5. inspect CI for the exact PR head SHA;
6. merge when repository acceptance passes;
7. verify the intended base state afterward.

Before final reporting, remove temporary workflows, scripts, debug output, abandoned intermediates, superseded paths, and stale task/document references. Branch deletion is not part of the agent responsibility when the connection lacks that capability.

Documentation must describe current executable behavior. Maintained boundaries are:

- `README.md` — human onboarding
- `AGENTS.md` — repository-wide agent rules
- `docs/QUALITY_GATES.md` — gate ownership
- `docs/standard/` — operational standards
- `docs/adr/` — architecture decisions

Never expose secrets, OAuth credentials, private tokens, or private local metadata in public artifacts.

Final reporting should state only verified facts relevant to the task: repository/PR, what changed, deterministic checks actually run, exact-head CI, merge state, and any separately verified product/runtime/external result. Stop when the requested scope reaches its fixed point.