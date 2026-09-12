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

## Evidence boundary

Repository checks prove only the exact revision they executed. Product/runtime/publication are separate states and require direct evidence from the target artifact or service. Unchecked layers remain `UNVERIFIED`.

## Publication

Publication is an irreversible external side effect. Use only the canonical Taskfile publish path and require explicit publication authorization.

For 秒算マネー preparation:

```bash
task byosan:prepare DATE=YYYY-MM-DD
```

Preparation must not publish. Publish only after separate authorization using the exact command emitted by the successful preparation flow.

Publication is verified only after the remote receipt/read-back confirms the intended channel and result.
