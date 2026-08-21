# YT3 quality gates

YT3 keeps repository acceptance and product/runtime evidence orthogonal. Neither may be inferred from the other.

Two forbidden conclusions define the boundary:

- **“The real machine/environment is unavailable, therefore this code cannot be merged.”** Forbidden. Missing target-environment evidence makes the relevant product/runtime criterion UNVERIFIED; it does not make repository acceptance fail.
- **“CI is green, therefore the product is complete.”** Forbidden. CI proves repository acceptance criteria only; product completion requires direct product/runtime evidence.

## Evidence model

| evidence/state | valid conclusion | invalid conclusion |
|---|---|---|
| `check:merge` / green CI | revision satisfies repository merge criteria | product is complete, works on target, is releasable, or was released |
| target machine/service unavailable | target-specific criterion remains UNVERIFIED | revision is unmergeable |
| simulator/mock/contract test passes | deterministic repository boundary holds | target behavior actually occurred |
| `release:check` passes | concrete artifact passes local release preflight | remote publication occurred |
| target/runtime verification passes | tested product criterion holds on that target | unrelated repository criteria pass |
| remote receipt/read-back passes | specified external postcondition occurred | source quality or mergeability |

## Gate 1: repository merge acceptance

The merge gate answers one question: **does this repository revision satisfy the source/repository contract?**

Canonical commands:

```bash
task check:merge:fast
task check:merge
```

`check:merge:fast` checks repository/source state such as:

- Biome formatting and lint
- TypeScript type safety
- repository executable/documentation contract
- static YouTube profile/routing contract
- source-level no-fallback policy

`check:merge` adds the Bun test suite under `SKIP_LLM=true DRY_RUN=true`.

### Environment-independence rule

The merge gate must be reproducible in the supported development/CI environment. It must not require:

- a particular production machine or device
- production OAuth credentials
- a specific `RUN_ID`
- current YouTube remote state
- historical `runs/` cleanup receipts
- whether a concrete video is currently ready to publish

Hardware/service-specific code must expose a deterministic merge-time boundary: typed interfaces, schema/contract tests, fixtures, mocks, emulators, simulators, static checks, or another reproducible substitute appropriate to the boundary.

If a behavior can only be proven on the real target, that criterion belongs to product/runtime qualification. Until the target is available, mark it **UNVERIFIED**. Do not hold the PR unmergeable solely because the target environment cannot be exercised.

GitHub Actions runs `bun run check:merge`. The pre-commit/pre-push hook runs `bun run check:merge:fast`.

`task check` and `task check:fast` remain compatibility aliases, but new automation and documentation should use the explicit `check:merge*` names.

A passing merge gate proves repository acceptance for that exact commit and nothing more.

## Gate 2: product qualification and release

Product completion answers a different question: **do the product acceptance criteria have direct evidence in the environment where they are defined?**

Green CI is never sufficient evidence for this verdict.

For YT3 publication, the canonical local preflight is:

```bash
task release:check PROFILE=byosan -- <run-id> [video-path]
task release:check PROFILE=yawa -- <run-id> [video-path]
task release:check PROFILE=humanity -- <run-id> [video-path]
```

The release gate is run-specific. It verifies:

- explicit profile and exact profile-to-environment routing
- run bucket matches the selected channel profile
- run directory and canonical state exist
- selected video artifact exists and has a stable SHA-256 identity
- fallback-labeled metadata is prohibited
- canonical publication state does not point at a different artifact
- unresolved `PRIVATE_UPLOAD_INTENT` / `UNCERTAIN_REMOTE_COMMIT` state without a verified video ID blocks another release
- factual-integrity evidence passes when configured visibility is non-private

Passing local release preflight does not establish product completion by itself when the product contract requires target/runtime checks beyond that preflight.

`src/scripts/publish_youtube.ts` executes the release gate before OAuth/channel verification or YouTube publication. After local preflight, the publication path still verifies authenticated channel identity, stages upload state, reads back remote identity/visibility, applies requested visibility, and records publication evidence.

Those are product/release conditions, not PR merge conditions.

## Product status must remain explicit

Use separate states rather than one overloaded “done” flag:

- **repository mergeable** — merge gate passed for the exact revision
- **product criteria verified** — required product/runtime checks passed
- **release-ready** — concrete artifact passed its release preflight
- **released/externally applied** — remote side effect has a receipt/read-back
- **UNVERIFIED** — required evidence could not be obtained

Do not translate `UNVERIFIED` into failure outside the criterion it belongs to. Do not translate repository success into product success.

## Runtime policy audits are operational evidence

The no-fallback audit has independent scopes:

```bash
task audit:no-fallback:source
task audit:no-fallback:runtime
task audit:no-fallback
```

`source` is a merge-time invariant. `runtime` checks historical production deletion evidence. The combined task is useful for operations and audits, but runtime receipt state is intentionally not a PR merge blocker.

## Ownership matrix

| concern | owner | merge gate | product/release |
|---|---|---:|---:|
| formatting + lint | Biome | yes | no |
| TypeScript types | TypeScript compiler | yes | no |
| executable/docs contract | repository audit | yes | no |
| static channel routing | repository audit | yes | inherited invariant |
| source no-fallback policy | repository audit | yes | inherited invariant |
| unit/contract/simulation tests | repository checks | yes | not target evidence |
| target machine/runtime behavior | product qualification | no | yes when required |
| concrete run state | product release gate | no | yes |
| artifact identity | product release gate | no | yes |
| factual-integrity evidence | product release gate | no | yes |
| canonical publication conflict state | product release gate | no | yes |
| authenticated remote channel | YouTube publication path | no | yes |
| remote visibility/read-back | YouTube publication path | no | yes |
| historical fallback deletion receipts | runtime audit | no | operational |

## Fresh-clone contract

A clean checkout needs Bun, then:

```bash
bun run setup
bun run check:merge
```

`setup` uses `bun ci` with the committed `bun.lock`; dependency-resolution drift therefore fails rather than silently rewriting the dependency graph.

A fresh clone must be capable of establishing mergeability without access to production hardware, production credentials, or a concrete release run.

## Boundary validation

Zod remains the runtime boundary parser for untrusted API, artifact, configuration, and persisted-state inputs. New boundary work should parse once, then pass typed values inward.

For hardware/service boundaries, prefer deterministic repository-level contracts plus separate target qualification. The deterministic substitute proves interface and logic behavior; target qualification proves actual target behavior. Neither substitutes for the other.

## Tool decisions

### Oxlint: not installed

Adding Oxlint would create a second lint owner beside Biome without a measured migration/parity phase. If Biome is replaced later, migrate rules first and remove overlap before making another linter canonical.

### Nx: not installed

YT3 is not a genuine multi-project monorepo with an Nx task-graph requirement. Adding Nx would increase orchestration surface without replacing a current bottleneck.

### prek / pre-commit

`.pre-commit-config.yaml` contains one local hook whose entry is `bun run check:merge:fast`. `prek` and upstream `pre-commit` can both consume the same configuration; neither defines a separate quality implementation.

## CI evidence

For repository-change PRs, inspect the GitHub Actions result on the exact PR head SHA before merge.

A passing CI run means **repository merge acceptance passed for that revision**. It must never be reported as “product complete”, “production verified”, “works on the real machine”, “release verified”, or equivalent unless those separate criteria were directly checked.

Conversely, inability to access the target machine, production service, or release credentials must never be reported as a reason the repository cannot merge when the repository merge gate itself passes.
