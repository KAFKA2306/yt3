# YT3 Agent Contract

`AGENTS.md` is the only repository-wide agent rule file. `GEMINI.md` and `.claude/CLAUDE.md` only import it. `Taskfile.yml` is the canonical executable interface.

## Products

- `byosan`: 秒算マネー
- `yawa`: 夜話アーカイブ ASMR
- `humanity`: 雨晴はうの人類観測所

`humanity` has `docs/humanity/MISSION.md` (editorial direction) and `docs/humanity/SOUL.md` (character); `byosan` has `docs/byosan/MISSION.md`.

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
- Owner instruction 2026-11-05: byosan publication no longer requires the factual-integrity attestation (`steps.youtube.require_factual_integrity: false` in `config/domains/byosan_money.yaml`). The release gate still checks the run bucket, fallback metadata, a playable artifact, and the artifact hash. Number, source, and rights correctness of a byosan video is then the responsibility of whoever produces it. yawa and humanity are unchanged.
- A byosan run is publish-ready only when preparation prints `[product-release-gate] PASS ... artifact_sha256=<sha256>`, `PUBLISH_READY_RUN=<run-id>`, and `PUBLISH_COMMAND=...`. Record the run id, SHA-256, and command in the governing Issue. If any condition fails, stop. Do not bypass or retry around a failed gate.
- `DATE` must be given explicitly in `YYYY-MM-DD`. Never infer today.
- Byosan publishes one or more videos a day, never zero. Each run is named `<date>-daily-<HHmm>` (`BYOSAN_SUFFIX`); an already-published day does not stop another run, and only a source reused within `discovery.repeat_window_days` is rejected. The timer slots are in `systemd/yt3-byosan-daily.timer`.
- **Publication authorization is per run and always explicit (owner instruction, 2026-11-07, binding).** An agent publishes only after the owner names that exact run-id and artifact in the current conversation. A standing or daily authorization does not cover agent publication. An agent must not run `task publish`, `task yawa:daily`, `task byosan:daily`, or `task humanity:*` publish paths on its own initiative. `yawa` metadata changes also need explicit per-run authorization.
- **Run inputs are always explicit.** `DATE`, `SLOT`, `RUN`, and profile must be supplied by the owner or taken from the run's own record; never inferred. Missing credentials (for example `config/.env.yawa`) stop the run and are reported as blocked; agents do not create or fetch them.
- Publication is VERIFIED only after remote receipt and read-back.

## Autonomous operations

- Commit after the checks that cover the change pass, staging only the paths you own.
- Replace, do not layer: when a new mechanism supersedes an old one, delete the old code, config keys, tests, and documentation lines in the same change. Keep no compatibility shims or spare paths. Before deleting, confirm by type check and search that nothing references it, and run the new path once end to end.
- Push each commit to `origin` immediately.
- Merge a PR with `gh pr merge --merge` when exact-head CI passes. Do not squash or rebase.
- Close an Issue only after its fix is merged to `main` and the acceptance evidence is recorded in it.
- **One-branch rule (owner mandate, 2026-11-07, binding):** `main` is the only branch. Commit and push to `main` directly. Do not create feature, subagent, or `env-refresh/*` branches. A branch that already exists must be folded into `main` and deleted once its work is merged; deleting a branch whose work is not merged still needs the owner's instruction.
- Keep Issues few. Delete a branch, local and remote, once its PR is merged. Fold Issues that overlap into one, and close an Issue that no longer applies with the reason recorded in it. Open a new Issue only for work that no open Issue covers.
- Not covered, and requiring the owner's explicit instruction: force push, deleting a branch whose work is not merged, deletion of run data or published videos, billing, and handling of secrets or contact details.

## Byosan prompt and constraint policy

Current Claude models follow prompts closely, so over-specified prompts and stacked checks degrade output. Prompts state the goal and the facts that must hold, not the method. A check that stops a daily run is limited to number and source integrity, the actual/estimate/forecast distinction, rights, a playable artifact, and the publication gates. Other quality heuristics are not gates.

The byosan topic and script come from one LLM call over the full bodies of the day's new articles and the FactSet baseline, with no intermediate summary stage. The number, source, and published-source checks run deterministically against those articles, and a failed check rewrites the same call with the findings attached, up to `llm.max_attempts`.

LLM backends are set per stage in `llm.backends` (`gemini`, `codex`, `claude`). When `codex` hits a usage or rate limit, the same call is redone on `llm.fallback_backend` within the same run and the switch is recorded as a `fallback` event in `audit/llm_calls.jsonl`; a limit on `claude` fails the run explicitly. The deterministic script checks are identical for every backend. Script generation produces one draft and runs the deterministic checks; persona panel review is not part of daily production. Daily publication is mandatory.

## Byosan visuals and titles

Video visuals are rendered by OpenMontage's Remotion `Explainer` composition, installed outside this repository (AGPL-3.0) at `feature_production.video.openmontage.dir` and pinned to `ref` (`task setup:openmontage`). `src/domain/byosan/openmontage_visuals.ts` turns each timed segment into one scene (a stat card for one number, a comparison for two, a callout for three, a bar chart for a chart, a title card for the opening, a text card otherwise); chart series keep their actual/estimate/forecast label. FFmpeg then burns the byosan captions and mixes the audio as before. The old character slides (`scene_svg.ts`, `src/remotion`) were removed on 2026-11-05 by owner instruction. The thumbnail is separate: `codex-imagegen` (gpt-image-2) draws the two characters from the reference sprites, and the question text (`thumbnailTitle`) is overlaid deterministically with the project font so the wording and numbers are exact (`feature_production.thumbnail` in config). Published thumbnails are replaced only through `task byosan:thumbnail` and published titles only through `task byosan:metadata ... -- --title=TEXT`, each read back and recorded; a published video's first slide cannot be changed. The title is one strong simple question set by `discovery.title_rule`; that questions raise click-through is UNVERIFIED and is measured against real viewer metrics (#416).

Script quality is steered by guidance lines in `dialogue_style.guidance` (direction, not gates), written from independent persona reviews of published videos; the review mean is a reference only and never blocks or reshapes a run.

## Evidence and credentials

- Repository checks prove only the revision they executed. Product, runtime, and publication states need direct evidence; unchecked layers stay UNVERIFIED.
- Every factual claim the user makes is checked each time by web search against official sources before it is used in a decision, document, or config. Unverified claims are labeled UNVERIFIED, never adopted as fact.
- Dependencies, runtimes, CLIs, models, and model IDs are kept at their latest released version, confirmed against the official release notes. An upgrade lands only after `task check:merge` passes.
- The default Codex model is GPT-6.1 Terra at `medium` reasoning effort (owner-designated 2026-10-27; official valid efforts: none, low, medium, high, xhigh, max). The byosan setting is `llm.codex` in `config/domains/byosan_money.yaml`, the yawa setting is `script.model` in `config/yawa/daily.yaml`. A call moves to another model only with recorded evidence that Terra's output fails its checks. Image generation keeps `gpt-image-2`.
- Do not fill in missing inputs or failures with fallback output that looks like success.
- Execution runs as the `kafka` account, never as root or with `sudo`.
- Do not read out or display `.env` files, tokens, OAuth credentials, or contact details. Scripts check only whether a value is present. An empty value must not overwrite a non-empty one.
- Personal contact details never go into external requests, repositories, videos, PRs, Issues, or logs.

## Environment refresh

- The hourly loop in [docs/standard/environment-refresh.md](docs/standard/environment-refresh.md) runs `task env:refresh` through `systemd/yt3-env-refresh.timer`. Its research, change, measurement, rollback, and ledger rules are owned by that standard.
- Each cycle makes one bounded change with a measurement that can fail. Adopt only measured improvements; record outcomes in `logs/environment-refresh.jsonl`.
- Cycles commit to `main` under the one-branch rule. They never merge, publish, delete user data, force-push, or run sudo. sudo-only steps are recorded as `blocked`.
- A dirty working tree stops the cycle. Other sessions' changes are reported, not reverted.
- Other repositories receive proposals in the ledger, not edits.
