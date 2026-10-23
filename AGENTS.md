# YT3 Agent Contract

`AGENTS.md` is the repository-wide instruction source. `GEMINI.md` and `.claude/CLAUDE.md` may only import it; tool-specific skills must not duplicate repository-wide rules.

`Taskfile.yml` is the canonical executable interface.

## Products

YT3 contains three distinct products:

- `byosan`: 秒算マネー
- `yawa`: 夜話アーカイブ ASMR
- `humanity`: 雨晴はうの人類観測所

Keep their config, media, credentials, receipts, and publication state separate. Read volatile values from current config/runtime instead of copying them into agent instructions.

## Product execution

Fix the owning source rather than generated output or stale prose. Do not hide missing inputs or failures with fallback output that resembles success.

An explicit request to run or start a production path means executing its canonical Taskfile command on the target runtime when that capability is available. CI, mocks, simulations, and dry runs do not satisfy that request.

### Standing authorization (yawa)

The owner has authorized autonomous daily publication for 夜話アーカイブ ASMR (`yawa`) through `task yawa:daily`, without a per-episode approval, once the product release gate passes. This is a standing instruction for `yawa` only. It does not extend to `byosan` or `humanity`, and it does not cover manual publication of a run outside the daily path. Metadata rewrites of published `yawa` videos go only through `task yawa:metadata RUN=<run-id>`, which reads back and records the result.

## Evidence boundary

Repository checks prove only the exact revision they executed. Product/runtime/publication are separate states and require direct evidence from the target artifact or service. Unchecked layers remain `UNVERIFIED`.

## Publication

Publication is an irreversible external side effect. Use only the canonical Taskfile publish path and require explicit publication authorization.

For 秒算マネー preparation:

```bash
task byosan:prepare DATE=YYYY-MM-DD
```

Preparation must not publish. Publish only after separate authorization using the exact command emitted by the successful preparation flow.

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

Every commit must be pushed to `origin` before reporting completion. Do not leave commits local-only.

Before final reporting, remove temporary workflows, scripts, debug output, abandoned intermediates, superseded paths, and stale task/document references. Branch deletion is not part of the agent responsibility when the connection lacks that capability.

Documentation must describe current executable behavior. Maintained boundaries are:

- `README.md` — human onboarding
- `AGENTS.md` — repository-wide agent rules
- `docs/QUALITY_GATES.md` — gate ownership
- `docs/standard/` — operational standards
- `docs/adr/` — architecture decisions

Repository layout, root allowlist, ADR indexing, branch/worktree, and uncommitted-state rules: [docs/standard/repository-layout-standard.md](docs/standard/repository-layout-standard.md).

Never expose secrets, OAuth credentials, private tokens, or private local metadata in public artifacts.

Links are written as bare URLs on their own line, with a blank line before and after and no other character on that line. Never put text, punctuation, brackets, or markdown link syntax next to a URL, because the terminal cannot open it otherwise. This rule is invariant for every report, handoff, Issue, PR description, and document.

Final reporting should state only verified facts relevant to the task: repository/PR, what changed, deterministic checks actually run, exact-head CI, merge state, and any separately verified product/runtime/external result. Stop when the requested scope reaches its fixed point.

## 8. Delegate next work to the agent team and act autonomously

- Delegate each independent next task to an agent team member. The lead agent integrates results, runs the final verification, and reports.
- Give each agent an explicit file or directory ownership set. Do not let two agents edit the same file.
- Agents do not commit. The lead stages only the files it owns, so uncommitted changes from other sessions stay untouched.
- Proceed without asking when the next step is reversible and inside the requested scope. Record the choices made in the final report.
- Autonomy never authorizes publication, merge, deletion, billing, external posting, or secret handling. Those still follow §3, §5, and §7.
- When another session's changes appear in the working tree, do not revert or overwrite them. Report them.
- Work that cannot be completed in this session, and blockers, are handed to an external agent CLI instead of being left as a note: `codex exec -p <profile> "<prompt>"` or `agy -p "<prompt>"`. Hand off the exact remaining task, owned files, acceptance command, and stop condition. The receiving CLI must not publish, merge, delete, bill, post externally, or read secrets (§3, §5, §7 still apply).
- Profiles are chosen explicitly. Do not use a profile with `danger-full-access` or `approval_policy = "never"` unless the user names it for that task. Record the profile name and the handoff result in the final report.
- Official docs (checked): `codex exec` defaults to a read-only sandbox, so pass `--sandbox workspace-write` for edits. Codex profiles are documented as `$CODEX_HOME/<name>.config.toml` selected with `--profile`; the `[profiles.*]` tables in `~/.codex/config.toml` are UNVERIFIED for `codex exec`. `agy -p` needs a prior interactive `agy` login (an unauthenticated run fails with `authentication required`), and it uses `--print-timeout` (default 5m) and `--output-format json` when the result must be parsed. Piped `agy -p` hangs were reported in GitHub issues #76 and #318; test before depending on it.
- Rule maintenance (this section and its CLI commands) is delegated to a subagent and is done when the commands above are confirmed to exist and the rule text passes that check.

## Outcome-first task interpretation (Altitude / Depth / Range / Speed)

- **Altitude:** Interpret a task as a verifiable user outcome, not only the named intermediate step. Infer the smallest justified acceptance criteria from the request and current repository state; do not silently expand scope or override explicit instructions.
- **Depth:** Use primary/current evidence and real domain tools and methods. Verify the actual postcondition independently of agent self-report, preferably on the exact changed revision or target runtime.
- **Range:** Combine code, data, tests, runtime/UI, and domain expertise when that materially improves the outcome, while respecting canonical owners and avoiding duplicate systems.
- **Speed:** Complete authorized read-only and reversible work through implementation, focused checks, and read-back without unnecessary approval loops. Bound retries and stop at the proven outcome.
- These principles never bypass repository-specific security, privacy, permission, publication, spending, destructive-action, or release boundaries. State verified results and any remaining `UNVERIFIED` layers.

## Compute-scaling adoption

Increasing model capability, context size or generation attempts must improve measured output quality on fixed source snapshots and comparable production tasks. Compare sourced-claim accuracy, contradictory claims, schema acceptance, completion rate, release-gate outcomes, runtime, and measured compute use before adoption. Maintain replaceable research/generation backends through current Taskfile and separate byosan, yawa and humanity profiles. Keep source attribution and privacy requirements intact. Additional compute does not grant publication authorization; production release and remote read-back retain their existing gates. Keep the prior lower-cost path when measured evidence does not support a change.
