# YT3 quality gates

YT3 keeps three verdicts separate:

1. **repository acceptance** — is this revision mergeable?
2. **product release readiness** — is this exact run/artifact locally releasable?
3. **external verification** — did the intended remote side effect actually occur?

Never infer one from another.

## Repository merge gate

```bash
task check:merge:fast
task check:merge
```

`check:merge:fast` checks:

- Biome formatting/lint
- TypeScript types
- static YouTube profile/routing contract

`check:merge` adds the Bun test suite under `SKIP_LLM=true DRY_RUN=true`.

CI runs the same full merge gate. A passing exact-head CI run proves repository acceptance for that revision only.

The merge gate must not require:

- production credentials
- a concrete `RUN_ID`
- current YouTube state
- historical runtime cleanup receipts
- a particular production machine/device

If a criterion can only be tested on the real target, it remains **UNVERIFIED** until product qualification. Missing target access is not a repository merge failure.

### Test scope decisions

Every test file under `tests/` runs in `check:merge`. These areas were reviewed when the suite was pruned (#335, #347):

| Area | Decision | Coverage |
| --- | --- | --- |
| Byosan discovery source schema | kept | `tests/byosan_discovery_sources.test.ts` (`DiscoverySourcesSchema`, `loadDiscoverySources`) |
| Byosan checkpoint invalidation | kept | `tests/byosan_checkpoint.test.ts` |
| Byosan preflight (ffmpeg, node dependencies, Python runtime, VOICEVOX) | removed | no publication-facing output depends on it; each dependency fails at its point of use. `tests/byosan_preflight.test.ts` and `tests/byosan_deps_preflight.test.ts` deleted |
| Byosan authenticity heuristics (scene kind runs, generic ratio, history similarity, comparison counts, verification roles) | removed | editorial heuristics, not gates. Only unresolved scene claims and third-party URLs fail the audit (`tests/byosan_authenticity_audit.test.ts`) |
| Byosan figure values matched against the script | removed | the figures still come from the explanation; only unsourced numbers are checked (`tests/byosan_spec_validation.test.ts`) |
| Discord bot failure exit codes | added | `tests/discord_exit_codes.test.ts`: authentication failures exit 78 (systemd does not restart), network failures exit 1 |
| Overlay layout bounds | added | `tests/layout_bounds.test.ts`: height ratio and anchor placement used by rendered overlays |
| Publish start/complete Discord notices | not kept | message text only; publish gating is covered by `tests/publish_contract.test.ts` and `tests/publication_state.test.ts` |
| Discord webhook 429 suppression | not kept | notification delivery only; no publication or data effect |
| Active run discovery | removed | the module had no callers in the repository, so the module and its test were deleted |
| Repository structure, documentation, KPI plan, config-shape, and source-policy checks | removed | structure rules (root allowlist, ADR index, doc path references, Taskfile/doc contract, KPI plan traceability, hardcode and source-registry coverage) no longer block merges; their scripts, configs, and tests were deleted |

## Product release gate

```bash
task release:check PROFILE=byosan -- <run-id> [video-path]
```

Use `PROFILE=yawa` or `PROFILE=humanity` for the other channels.

The release gate verifies one exact run/artifact:

- explicit profile and canonical profile routing
- run bucket/profile agreement
- canonical run state
- artifact existence and SHA-256 identity
- no fallback-labeled metadata
- no conflicting or uncertain canonical publication state
- factual-integrity evidence when configured visibility is non-private

Passing this gate does not prove publication occurred.

`task publish PROFILE=<profile> -- <run-id> [video-path]` runs the same release gate before OAuth/channel verification or any YouTube side effect, then records canonical publication evidence and remote read-back state.

## Ownership

| concern | owner | merge gate | release/product |
|---|---|---:|---:|
| formatting + lint | Biome | yes | no |
| TypeScript types | TypeScript compiler | yes | no |
| static channel routing | repository audit | yes | inherited |
| unit/contract tests | repository checks | yes | not target evidence |
| target runtime behavior | product qualification | no | when required |
| concrete run/artifact | product release gate | no | yes |
| authenticated channel | publication path | no | yes |
| remote receipt/read-back | publication path | no | yes |

## Fresh clone

```bash
bun run setup
bun run check:merge
```

`setup` uses `bun ci` with committed `bun.lock`, so dependency drift does not silently rewrite the graph.

Zod remains the parser for untrusted API, artifact, configuration, and persisted-state boundaries. Parse once at the boundary and pass typed values inward.

## Tool ownership

- **Biome** is the only lint/format owner.
- **TypeScript** is the type owner.
- **Oxlint** is not installed because it would duplicate lint ownership without a migration.
- **Nx** is not installed because YT3 does not need a monorepo task graph.
- `.pre-commit-config.yaml` delegates to `bun run check:merge:fast`; hooks do not implement a separate gate.

A green CI run must never be reported as product completion or production verification. Conversely, unavailable production hardware, credentials, or services must never be reported as a repository merge blocker when the merge gate itself passes.
