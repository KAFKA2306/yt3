# YT3 quality gates

This repository uses one deterministic quality path locally and in CI.

## Stack and ownership

| concern | owner | command | notes |
|---|---|---|---|
| formatting + lint | Biome | `bun run lint` | one lint owner; no second overlapping linter |
| TypeScript types | TypeScript compiler | `bun run typecheck` | `tsc --noEmit` remains the type authority |
| untrusted runtime boundaries | Zod | schema `.parse(...)` at API/artifact/config boundaries | do not add validation to already-trusted internal values |
| publish safety | repository audits | `bun run audit:publish-routing`, `bun run audit:no-fallback` | fail closed before publish |
| unit/contract tests | Bun test | `bun run test` | integration behavior remains in CI |

The canonical commands are:

```bash
bun run setup
bun run check:fast
bun run check
```

`check:fast` is the pre-commit/pre-push deterministic gate. `check` adds the Bun test suite and is the CI gate.

## Tool decisions

### Oxlint: not installed

Oxlint is a valid 2026 TypeScript/JavaScript linter and supports type-aware linting, but adding it here would create a second lint owner beside Biome without a measured migration/parity phase. That violates this repository's single-owner rule. If Biome is replaced later, migrate rules first and remove overlap before making Oxlint canonical.

Primary docs:

- https://oxc.rs/docs/guide/usage/linter/cli
- https://oxc.rs/docs/guide/usage/linter/type-aware

### Nx: not installed

YT3 is not a genuine multi-project monorepo with an Nx task graph requirement. Adding Nx would increase orchestration surface without replacing a current bottleneck.

### prek: configuration only

`.pre-commit-config.yaml` defines one local hook whose entry is exactly `bun run check:fast`. `prek` and upstream `pre-commit` can both consume this configuration; neither introduces a second quality implementation.

Primary docs:

- https://prek.j178.dev/reference/cli/
- https://prek.j178.dev/reference/configuration/

## Fresh-clone contract

A clean checkout needs Bun, then:

```bash
bun run setup
bun run check
```

`setup` uses `bun install --frozen-lockfile`, so CI refuses dependency-resolution drift when a Bun lockfile is present. This repository does not add a second package manager or parallel lockfile.

## Boundary validation

Zod is already a runtime dependency and is used for external/state/artifact boundaries. New boundary work should parse the untrusted value once, then pass typed data inward. Examples include `AgentStateSchema`, dancer manifest import, YouTube Analytics evidence, and canonical publication-state parsing.

## CI timing evidence

The previous CI split typecheck, Biome, publish audits and tests into separate workflow steps. The current workflow invokes the same sequence through `bun run check`, removing duplicated orchestration rather than removing checks.

For each migration PR, GitHub Actions run duration is the before/after timing evidence. Record the exact-head run in the PR before merge; do not claim a speedup without that measured run.
