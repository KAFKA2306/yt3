# YT3 Agent Contract

`AGENTS.md` is the only repository-wide agent rule file. `GEMINI.md` and `.claude/CLAUDE.md` only import it. `Taskfile.yml` is the canonical executable interface.

## Products

- `byosan`: 秒算マネー
- `yawa`: 夜話アーカイブ ASMR
- `humanity`: 雨晴はうの人類観測所

Keep each product's config, media, credentials, receipts, and publication state separate. Work on one product must not change another product's files, configuration, timers, or GPU assumptions.

## Canonical commands

- `task setup`, `task check:merge:fast`, `task check:merge`
- `task byosan:prepare DATE=YYYY-MM-DD`: research, produce, audit, and release-check without publishing
- `task byosan:auto DATE=YYYY-MM-DD`: prepare with repair attempts, stopping before publish
- `task release:check PROFILE=<profile> -- <run-id>`
- `task publish PROFILE=<profile> -- <run-id>`
- `task yawa:daily DATE=YYYY-MM-DD`, `task yawa:metadata RUN=<run-id>`
- `task humanity:music-daily DATE=YYYY-MM-DD`

## Publication

- Publication is an irreversible external side effect. Use only `task publish PROFILE=<profile> -- <run-id>` or the product's daily entry, and only when the release gate reports PASS for that exact run and artifact and `publish_approved` is enabled in `config/domains/`.
- A byosan run is publish-ready only when preparation prints `[product-release-gate] PASS ... artifact_sha256=<sha256>`, `PUBLISH_READY_RUN=<run-id>`, and `PUBLISH_COMMAND=...`. Record the run id, SHA-256, and command in the governing Issue. If any condition fails, stop. Do not bypass or retry around a failed gate.
- `DATE` must be given explicitly in `YYYY-MM-DD`. Never infer today.
- Standing authorization: daily publication of `yawa`, `byosan`, and `humanity` through their canonical Taskfile entries once the gate passes. Manual `yawa` publication outside the daily path is not covered. `yawa` metadata changes go only through `task yawa:metadata`.
- Publication is VERIFIED only after remote receipt and read-back.

## Autonomous operations

- Commit after the checks that cover the change pass, staging only the paths you own.
- Push each commit to `origin` immediately.
- Merge a PR with `gh pr merge --merge` when exact-head CI passes. Do not squash or rebase.
- Close an Issue only after its fix is merged to `main` and the acceptance evidence is recorded in it.
- Not covered, and requiring the owner's explicit instruction: force push, branch deletion, deletion of run data or published videos, billing, and handling of secrets or contact details.

## Byosan prompt and constraint policy

Current Claude models follow prompts closely, so over-specified prompts and stacked checks degrade output. Prompts state the goal and the facts that must hold, not the method. A check that stops a daily run is limited to number and source integrity, the actual/estimate/forecast distinction, rights, a playable artifact, and the publication gates. Other quality heuristics are not gates.

## Evidence and credentials

- Repository checks prove only the revision they executed. Product, runtime, and publication states need direct evidence; unchecked layers stay UNVERIFIED.
- Do not fill in missing inputs or failures with fallback output that looks like success.
- Execution runs as the `kafka` account, never as root or with `sudo`.
- Do not read out or display `.env` files, tokens, OAuth credentials, or contact details. Scripts check only whether a value is present. An empty value must not overwrite a non-empty one.
- Personal contact details never go into external requests, repositories, videos, PRs, Issues, or logs.
