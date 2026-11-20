# YT3 Agent Contract

`AGENTS.md` is the only repository-wide agent rule file. `GEMINI.md` and `.claude/CLAUDE.md` only import it. `Taskfile.yml` is the canonical executable interface.

## Products

- `byosan`: 秒算マネー
- `yawa`: 夜話アーカイブ ASMR
- `humanity`: 雨晴はうの人類観測所

`humanity` has `docs/humanity/MISSION.md` (narrative music label direction), `docs/humanity/SOUL.md` (character), and `docs/humanity/story-world.json`; `byosan` has `docs/byosan/MISSION.md` (2-lane financial/tech structure analysis); `yawa` has `docs/yawa/MISSION.md` (all-ages fixed-cast situation-voice theater) and `docs/yawa/characters.json`. All three products prioritize YouTube audience growth, advertiser-friendly monetization (YPP), and avoiding mass-produced/inauthentic repetition.

Keep each product's config, media, credentials, receipts, and publication state separate. Work on one product must not change another product's files, configuration, timers, or GPU assumptions.

## Canonical commands

- `task setup`, `task check:merge:fast`, `task check:merge`
- `task byosan:prepare DATE=YYYY-MM-DD`: research, produce, and audit without publishing
- `task byosan:publish-daily`: prepare and publish the current Tokyo date through the Byosan daily path
- `task publish PROFILE=<profile> -- <run-id>`
- `task yawa:daily DATE=YYYY-MM-DD`, `task yawa:metadata RUN=<run-id>`
- `task humanity:music-daily DATE=YYYY-MM-DD`

## Publication

- Publication is an irreversible external side effect. Use only `task publish PROFILE=<profile> -- <run-id>` or the product's daily entry, and only when `publish_approved` is enabled in `config/domains/`.
- Owner instruction 2026-11-08: there is no release gate. The product release gate (`task release:check`, `product_release_gate.ts`) and the factual-integrity attestation gate (`steps.youtube.require_factual_integrity`) were removed. `task publish` still checks that the run bucket matches the profile and that no unresolved remote upload intent exists, and publication is VERIFIED only after read-back. Number, source, and rights correctness of a video is the responsibility of whoever produces it.
- Byosan daily CI synchronization, feature/production/authenticity/canonical audits, and daily audit reporting are not publication prerequisites. They record diagnostics and must not change the daily publisher's exit status based on findings. Repository CI remains separate from the scheduled publish path.
- A byosan run is ready when preparation prints `PUBLISH_READY_RUN=<run-id>` and `PUBLISH_COMMAND=...`. Record the run id and command in the governing Issue.
- For canonical daily production, use the current Asia/Tokyo calendar date when `DATE` is omitted; do not stop a daily run for a missing date. Use explicit dates for requested backfills or future-dated runs.
- Daily publication has no fixed per-day item cap. Use a unique `SLOT` when the canonical entry needs separate run IDs for multiple same-day items.
- Byosan publishes one or more videos a day, never zero. Each run is named `<date>-daily-<HHmm>` (`BYOSAN_SUFFIX`); an already-published day does not stop another run, and only a source reused within `discovery.repeat_window_days` is rejected. The timer slots are in `systemd/yt3-byosan-daily.timer`.
- Standing authorization: daily publication of `yawa`, `byosan`, and `humanity` through their canonical Taskfile entries. Manual `yawa` publication outside the daily path is not covered. `yawa` metadata changes go only through `task yawa:metadata`.
- Missing credentials (for example `config/.env.yawa`) stop the run and are reported as blocked; agents do not create or fetch them.
- Publication is VERIFIED only after remote receipt and read-back.
- Every verified YouTube publication shares its direct URL through `DISCORD_WEBHOOK_URL` and confirms the Discord message by read-back. This URL delivery bypasses general notification quotas; YouTube publication is blocked before upload when the webhook is not configured locally in the repository root `.env`.

## Autonomous operations

- Commit after the checks that cover the change pass, staging only the paths you own.
- Replace, do not layer: when a new mechanism supersedes an old one, delete the old code, config keys, tests, and documentation lines in the same change. Keep no compatibility shims or spare paths. Before deleting, confirm by type check and search that nothing references it, and run the new path once end to end.
- Push each commit to `origin` immediately.
- Merge a PR with `gh pr merge --merge` when exact-head CI passes. Do not squash or rebase.
- Close an Issue only after its fix is merged to `main` and the acceptance evidence is recorded in it.
- **One-branch rule (owner mandate, 2026-11-07, binding):** `main` is the only branch. Commit and push to `main` directly. Do not create feature, subagent, or `env-refresh/*` branches. A branch that already exists must be folded into `main` and deleted once its work is merged; deleting a branch whose work is not merged still needs the owner's instruction.
- **Worktree rule (owner mandate, 2026-11-18):** Do not create Git worktrees. Review and integrate changes from existing worktrees into `main` before retiring them, and preserve their ignored or untracked user state outside the worktree.
- Keep Issues few. Delete a branch, local and remote, once its PR is merged. Fold Issues that overlap into one, and close an Issue that no longer applies with the reason recorded in it. Open a new Issue only for work that no open Issue covers.
- Not covered, and requiring the owner's explicit instruction: force push, deleting a branch whose work is not merged, deletion of run data or published videos, billing, and handling of secrets or contact details.

## Creative authoring

Yawa, Humanity, and Byosan create new work through the shared model router in `src/io/creative.ts`. Its defaults are configured in `config/creative_authoring.yaml`: bounded title proposals and reviews use `codex exec` with GPT-6 Luna at low reasoning effort; full story, script, song, and feature drafts use AGY Gemini 4 Hydrogen at medium effort. For a deliberate one-run override, set `YT3_CREATIVE_TITLE_ROUTE=codex:<model>:<effort>` / `YT3_CREATIVE_DRAFT_ROUTE=codex:<model>:<effort>`, or use `agy:<model>`; the selected provider and model are recorded with each run. Neon is an optional model choice, not a production requirement. The router fails explicitly when the selected route is unavailable and does not silently retry through a different provider or API billing path. Before drafting, the title route reviews a proposed title without the completed text; after drafting, it compares that critique with the work and keeps or changes the title. Each product keeps its own brief and output format. Research, audio/image generation, JIZURA, editing, and the canonical publication entries remain product-owned.

Humanity grows one shared story world from `docs/humanity/story-world.json`; songs keep a clear standalone concept while developing its relationships. Its JIZURA lyric video uses a Neon-selected built-in theme and keeps the rendered project beside the video.

## Byosan prompt and constraint policy

Current Claude models follow prompts closely, so over-specified prompts and stacked checks degrade output. Prompts state the goal and the facts that must hold, not the method. Byosan feature, production, and authenticity audits are recorded for review and do not stop a daily run. Runtime failures that prevent preparation or upload still surface as errors.

Byosan title ideation uses article headlines and the supplied subject. The feature draft is one AGY call over the full bodies of the day's new articles and the FactSet baseline, with no intermediate summary stage. A final title review compares the title critique with the completed feature. Feature, source, and published-source audit findings are saved with the run as diagnostics; structured output and schema parsing still provide the data needed to render.

The remaining Byosan digest uses `llm.backends.digest` (`gemini`, `codex`, or `claude`). When Codex hits a usage or rate limit there, the same digest call is redone on `llm.fallback_backend` within the run and the switch is recorded in `audit/llm_calls.jsonl`; a limit on Claude fails explicitly. Daily feature creation uses AGY and has no alternate creative backend. Daily publication is mandatory.

## Byosan visuals and titles

Video visuals use the existing OpenMontage renderer and FFmpeg pipeline. Its visual scene types and available assets describe tool capabilities. Thumbnails are secondary: generate episode-specific art and overlay exact title text with the project font. No title syntax or fixed character arrangement is required.

The former 漫才 role contract was removed on 2026-11-07. Scripts may use either available character or both in the roles that suit the episode.

The visual standard is the KAFKA SIGNAL Design System (owner instruction 2026-11-08): pastel, watercolor and impressionist, one light theme. Colors: Primary `#7BA7E1`, Secondary `#B8A7E6`, Accent `#F7B7C1`, Success `#A8D5BA`, Warning `#FFD8A8`, Neutral `#8FA1B3`. The tokens live in `config/design/foundation.tokens.json`; `bun src/scripts/sync_video_design.ts` writes them into `kafka_visual_system_v1.json` and `byosan_video_system_v1.json`, and text stays in the ink foreground so pastel fills never carry text. The old navy palette, the dark tokens, the pin to `KAFKA2306/design`, and the HEAD-pinned design fixture were removed. The independent canonical repository of KAFKA SIGNAL is UNVERIFIED.

Each episode chooses its own opening, pacing, shape, and ending. Do not require a conclusion-first opening, one designated peak, declarative delivery, or a ban on spoken qualifications. Keep factual claims grounded and explain uncertainty where it helps the viewer understand the evidence.

Feature, production, and authenticity findings remain available as diagnostics. They inform review but do not prescribe a recurring style or block daily publication.

## Yawa video visuals

Every Yawa video is rendered through the vendored JIZURA. FFmpeg may mux the original audio and encode the final file.

Use timestamped episode dialogue as JIZURA subtitles, and let each episode choose its visual direction.

## Evidence and credentials

- Repository checks prove only the revision they executed. Product, runtime, and publication states need direct evidence; unchecked layers stay UNVERIFIED.
- Use [the repository record index](docs/standard/ledger-standard.md) to find record locations, grains, and schema owners; the actual contracts remain with their writers and readers.
- Every factual claim the user makes is checked each time by web search against official sources before it is used in a decision, document, or config. Unverified claims are labeled UNVERIFIED, never adopted as fact.
- Dependencies, runtimes, CLIs, models, and model IDs are kept at their latest released version, confirmed against the official release notes. An upgrade lands only after `task check:merge` passes.
- Non-creative Byosan Codex calls keep GPT-6.1 Terra at `medium` reasoning effort in `llm.codex` in `config/domains/byosan_money.yaml`. Creative title calls use the shared route above. Image generation keeps `gpt-image-2`.
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
