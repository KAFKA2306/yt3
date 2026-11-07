# Environment Refresh

The autonomous loop that keeps this workstation's development environment current, measured, and reversible. One cycle runs per hour via `systemd/yt3-env-refresh.timer`, which calls `task env:refresh` (`scripts/env_refresh.sh`).

## Scope

- In scope: Claude Code (version, plugins, MCP registrations), user-level npm/uv/pip tools, agent configuration in `/home/kafka/CLAUDE.md` and `AGENTS.md`, and the yt3 `scripts/`, `systemd/`, and `docs/standard/` surfaces.
- Proposal only: other projects. A cycle may record a proposal for another repository in the ledger. It must not edit another repository.
- Excluded: publication (YouTube and any external channel), merge, deletion of user data, model caches (HuggingFace, Ollama), Docker volumes, and anything requiring sudo. sudo-only work is recorded as `blocked` with the exact command for the user.

## Primary sources

Check these before choosing a change. Record the URL and the version or date you read in each ledger entry.

- Claude Code docs: https://code.claude.com/docs/
- Claude Code releases: https://github.com/anthropics/claude-code
- Codex docs: https://developers.openai.com/codex/
- Codex releases: https://github.com/openai/codex
- OpenAI API docs: https://developers.openai.com/api/docs/
- MCP specification: https://modelcontextprotocol.io/specification
- GitHub Actions docs: https://docs.github.com/actions

Competing products, OSS projects, and research may be searched as well. Prefer primary sources and version-pinned evidence. A search result alone does not justify a change.

## One cycle

1. **Research.** Read the primary sources for changes since the last ledger entry. Use `gh release list` or `gh api` for release notes.
2. **Diff.** Compare the current state with the sources. Read-only inspection commands: `claude --version`, `claude plugin list`, `claude mcp list`, `npm outdated -g`, `uv --version`, `apt list --upgradable` (read-only; never run apt itself).
3. **Select.** Choose at most one bounded improvement. Rank by expected gain in quality, speed, cost, or stability. Write the reason for choosing it.
4. **Implement.** Work directly on `main`. The repository runs a one-branch rule: no `env-refresh/*` or other branches. Make the smallest change that addresses the selected item. Config and docs live in the owning file. Do not duplicate an existing automation; the existing timers and cron jobs are listed in the ledger's first entry.
5. **Measure.** Run a before/after check that can fail: a version check, a smoke command, `task check:merge:fast` for repository changes, or a timed command for performance. Record the numbers.
6. **Decide.** Adopt only when the measurement shows a real improvement or a fix without regression. Otherwise reject and record why.
7. **Roll back on failure.** For repository changes, revert the commit on the cycle branch. For tool upgrades, reinstall the previous version recorded in the ledger. Record the rollback as its own entry.
8. **Record.** Append entries to the ledger (below).
9. **Commit and push.** Stage only the files this cycle changed. Commit with a Conventional Commit message on `main`, then push to `origin/main`. Never merge, force-push, or create a branch.

Stop condition: the cycle ends after step 9, or after step 7 when a rollback completes. Do not start a second improvement in the same cycle.

## Guardrails

- A dirty working tree stops the cycle before any change. Other sessions' changes are never reverted, overwritten, or committed.
- Never use `--dangerously-skip-permissions`. Headless permissions come only from the allowlist in `scripts/env_refresh.sh`.
- Never force-push, merge, create or delete branches, `rm -rf`, `git reset --hard`, `git clean`, or run `sudo`.
- Never execute `task publish`, `task release`, `task up`, `task run`, `task byosan:*`, `task yawa:*`, or `task humanity:*`.
- Each cycle is capped by `ENV_REFRESH_BUDGET_USD` (default 1) and a 50-minute timeout. The default model is `haiku`; override with `ENV_REFRESH_MODEL`.
- Overlapping runs are prevented by `flock` on `data/state/environment-refresh.lock`.
- Credentials, tokens, and private account metadata never go into a commit or a ledger entry.

## Ledger

`logs/environment-refresh.jsonl` is the append-only record. It is gitignored, so it stays local and permanent. Each line is one JSON object with `at`, `event`, and `detail`. Events:

- `started`, `finished`: written by `scripts/env_refresh.sh`.
- `skipped`: a dirty tree or an overlapping run.
- `research`: source URL, version or date read, and the finding.
- `decision`: `adopted`, `rejected`, or `deferred`, with the reason and the measurement.
- `rollback`: what was reverted and why.
- `blocked`: the step needs the user (for example sudo), with the exact command.
- `proposal`: a change for another repository, not applied.

Corrections are new entries. Entries are never edited or deleted, per [ledger-standard](./ledger-standard.md).

## Verification of this standard

- `DRY_RUN=1 task env:refresh` prints the exact headless command without starting Claude. Run it after changing the allowlist.
- `systemctl --user list-timers yt3-env-refresh.timer` shows the next run.
