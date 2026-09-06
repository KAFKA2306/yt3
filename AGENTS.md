# YT3 Agent Contract

`AGENTS.md` is the only repository-wide agent instruction source. `GEMINI.md` and `.claude/CLAUDE.md` may only import it. Tool-specific skills must not duplicate repository-wide rules.

`Taskfile.yml` is the canonical executable interface.

## Products

YT3 contains three distinct products:

- `byosan`: 秒算マネー
- `yawa`: 夜話アーカイブ ASMR
- `humanity`: 雨晴はうの人類観測所

Keep their config, media, credentials, receipts, and publication state separate. Read volatile values from current config/runtime instead of copying them into agent instructions.

## Execution

- Prefer current user instruction, current runtime observations, current code/config/Taskfile/tests, then maintained docs/history.
- Proceed with read-only and reversible work without unnecessary confirmation.
- Reuse one canonical implementation and one Issue/branch/PR per outcome.
- Fix the owning source rather than generated output or stale prose.
- Do not hide missing inputs or failures with fallback output that resembles success.
- An explicit request to run/start a production path means executing the canonical Taskfile command on the target runtime when that capability is available. CI, mocks, simulations, or dry runs do not satisfy that request.

## Verification

Run the smallest relevant deterministic check first. Broaden only when new changes, failures, or unresolved concerns justify it.

Repository checks prove only repository acceptance for the exact revision tested. Product/runtime/publication are separate and require direct evidence from the target artifact or service.

A check that did not run is not PASS.

## Publication

Publication is an irreversible external side effect. Use only the canonical Taskfile publish path and require explicit publication authorization.

For 秒算マネー preparation:

```bash
task byosan:prepare DATE=YYYY-MM-DD
```

Preparation must not publish. Publish only after separate authorization using the exact command emitted by the successful preparation flow.

Publication becomes verified only after the remote receipt/read-back confirms the intended channel and result.

## Git and completion

Re-read state before writes, read back after writes, and merge only the verified PR head.

Stop when the requested repository, artifact, runtime, or publication state is directly verified. Unchecked layers remain `UNVERIFIED`.
