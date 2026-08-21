# YT3 quality gates

YT3 has two independent decision gates. A pull request can be mergeable without any production run being releasable, and a production run can be evaluated for release without changing the definition of code quality.

## Gate 1: PR merge

The PR merge gate answers one question: **is this repository revision safe to merge?**

Canonical commands:

```bash
task check:merge:fast
task check:merge
```

`check:merge:fast` checks only repository/source state:

- Biome formatting and lint
- TypeScript type safety
- repository executable/documentation contract
- static YouTube profile/routing contract
- source-level no-fallback policy

`check:merge` adds the Bun test suite under `SKIP_LLM=true DRY_RUN=true`.

The merge gate must not depend on:

- production OAuth credentials
- a specific `RUN_ID`
- current YouTube remote state
- historical `runs/` cleanup receipts
- whether a concrete video is currently ready to publish

GitHub Actions runs `bun run check:merge`. The pre-commit/pre-push hook runs `bun run check:merge:fast`.

`task check` and `task check:fast` remain compatibility aliases, but new automation and documentation should use the explicit `check:merge*` names.

## Gate 2: product release

The product release gate answers a different question: **is this concrete run/artifact allowed to cross the publication boundary?**

Canonical preflight:

```bash
task release:check PROFILE=byosan -- <run-id> [video-path]
task release:check PROFILE=yawa -- <run-id> [video-path]
task release:check PROFILE=humanity -- <run-id> [video-path]
```

The release gate is run-specific. It verifies:

- explicit profile and exact profile-to-environment routing
- run bucket matches the selected channel profile
- run directory and canonical state exist
- the selected video artifact exists and has a stable SHA-256 identity
- fallback-labeled metadata is prohibited
- canonical publication state does not point at a different artifact
- unresolved `PRIVATE_UPLOAD_INTENT` / `UNCERTAIN_REMOTE_COMMIT` state without a verified video ID blocks another release
- factual-integrity evidence passes when configured visibility is non-private

`src/scripts/publish_youtube.ts` executes this gate before OAuth/channel verification or any YouTube publication step. Passing the local product release gate does **not** itself publish anything.

After the local gate passes, the publication path still verifies the authenticated YouTube channel, stages upload state, reads back remote identity/visibility, applies requested visibility, and records publication evidence. Those remote checks are release conditions, not PR merge conditions.

## Runtime policy audits are operational evidence

The no-fallback audit has independent scopes:

```bash
task audit:no-fallback:source
task audit:no-fallback:runtime
task audit:no-fallback
```

`source` is a merge-time invariant. `runtime` checks historical production deletion evidence. The combined task is useful for operations and audits, but runtime receipt state is intentionally not a PR merge blocker.

## Ownership matrix

| concern | owner | merge gate | release gate |
|---|---|---:|---:|
| formatting + lint | Biome | yes | no |
| TypeScript types | TypeScript compiler | yes | no |
| executable/docs contract | repository audit | yes | no |
| static channel routing | repository audit | yes | inherited invariant |
| source no-fallback policy | repository audit | yes | inherited invariant |
| unit/contract tests | Bun test | yes | no |
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

## Boundary validation

Zod remains the runtime boundary parser for untrusted API, artifact, configuration, and persisted-state inputs. New boundary work should parse once, then pass typed values inward. Release readiness is kept separate from merge readiness even when both reuse the same typed domain models.

## Tool decisions

### Oxlint: not installed

Adding Oxlint would create a second lint owner beside Biome without a measured migration/parity phase. If Biome is replaced later, migrate rules first and remove overlap before making another linter canonical.

### Nx: not installed

YT3 is not a genuine multi-project monorepo with an Nx task-graph requirement. Adding Nx would increase orchestration surface without replacing a current bottleneck.

### prek / pre-commit

`.pre-commit-config.yaml` contains one local hook whose entry is `bun run check:merge:fast`. `prek` and upstream `pre-commit` can both consume the same configuration; neither defines a separate quality implementation.

## CI evidence

For repository-change PRs, inspect the GitHub Actions result on the exact PR head SHA before merge. A passing merge gate proves repository acceptance criteria only; do not reinterpret it as proof that a concrete product run is releasable or published.
