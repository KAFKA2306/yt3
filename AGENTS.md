# YT3 Agent Contract

`AGENTS.md` is the only repository-wide agent rule file. `GEMINI.md` and `.claude/CLAUDE.md` only import it. `Taskfile.yml` is the canonical executable interface.

## Products

- `byosan`: 秒算マネー
- `yawa`: 夜話アーカイブ ASMR
- `humanity`: 雨晴はうの人類観測所

`humanity` has `docs/humanity/MISSION.md` (original music channel direction) and `docs/humanity/SOUL.md` (character); `byosan` has `docs/byosan/MISSION.md` (2-lane financial/tech structure analysis); `yawa` has `docs/yawa/MISSION.md` (all-ages fixed-cast situation-voice theater) and `docs/yawa/characters.json`. All three products prioritize YouTube audience growth, advertiser-friendly monetization (YPP), and avoiding mass-produced/inauthentic repetition.

Keep each product's config, media, credentials, receipts, and publication state separate. Work on one product must not change another product's files, configuration, timers, or GPU assumptions.

## Canonical commands

- `task setup`, `task check:merge:fast`, `task check:merge`
- `task byosan:prepare DATE=YYYY-MM-DD`: research, produce, and audit without publishing
- `task byosan:interactive DATE=YYYY-MM-DD SLOT=<lowercase-alphanumeric> [FACT_SHEET=<verified .json|.yaml>]`: prepare a separate owner-directed Byosan run with spoken-language editing
- `task byosan:publish-daily`: prepare and publish the current Tokyo date through the Byosan daily path
- `task publish PROFILE=<profile> -- <run-id>`
- `task yawa:daily DATE=YYYY-MM-DD`, `task yawa:metadata RUN=<run-id>`, `task yawa:playlists:sync [-- --apply|--verify-only]`
- `task humanity:music-daily DATE=YYYY-MM-DD`

## Publication

- Publication is an irreversible external side effect. Use only `task publish PROFILE=<profile> -- <run-id>` or the product's daily entry, and only when `publish_approved` is enabled in `config/domains/`.
- Owner instruction 2026-11-08: there is no release gate. The product release gate (`task release:check`, `product_release_gate.ts`) and the factual-integrity attestation gate (`steps.youtube.require_factual_integrity`) were removed. `task publish` still checks that the run bucket matches the profile and that no unresolved remote upload intent exists, and publication is VERIFIED only after read-back. Number, source, and rights correctness of a video is the responsibility of whoever produces it.
- Byosan daily CI synchronization, feature/production/authenticity/canonical audits, and daily audit reporting are not publication prerequisites. They record diagnostics and must not change the daily publisher's exit status based on findings. Repository CI remains separate from the scheduled publish path.
- A byosan run is ready when preparation prints `PUBLISH_READY_RUN=<run-id>` and `PUBLISH_COMMAND=...`. Record the run id and command in the governing Issue.
- For canonical daily production, use the current Asia/Tokyo calendar date when `DATE` is omitted; do not stop a daily run for a missing date. Use explicit dates for requested backfills or future-dated runs.
- Daily publication has no fixed per-day item cap. Use a unique `SLOT` when the canonical entry needs separate run IDs for multiple same-day items.
- Byosan runs on the 2-pillar model (owner mandate 2026-11-21): 3x/week structural documentaries (`Mon/Wed/Fri 07:00 JST` via `systemd/yt3-byosan-daily.timer`) plus event-driven regime-shift explainers triggered only when `task byosan:regime-watch -- --trigger` (`systemd/yt3-byosan-regime-watch.timer`, Tue–Sat 06:30 JST) detects a quantitative US-close market regime shift. Each run is named `<date>-daily-<HHmm>` (`BYOSAN_SUFFIX`); only a source reused within `discovery.repeat_window_days` is rejected.
- Standing authorization: daily publication of `yawa`, `byosan`, and `humanity` through their canonical Taskfile entries. Manual publication outside the daily path is covered only for the owner-directed interactive video runs below. `yawa` metadata changes go only through `task yawa:metadata`.
- Owner instruction 2026-11-21: When producing a video or test run during an interactive session with the owner, always proceed through YouTube publication (do not stop at `prepare`-only), because the owner verifies results directly on YouTube.
- Owner instruction 2026-11-23: When the owner initiates creative production in an interactive conversation, autonomously turn the work into a video, generate it, and publish it for the owner's YouTube-viewer evaluation. Give each interactive work its own run ID and a distinct `SLOT` or `BYOSAN_SUFFIX` where supported; keep it separate from routine scheduled production and never reuse or overwrite a scheduled run. Use the product's canonical production/publication path. This grants manual `yawa` publication outside its daily path only for these interactive runs.
- Owner instruction 2026-11-23: Interactive Byosan production uses `task byosan:interactive`; its dedicated humanization pass turns the draft into a short story with one clear spine, cuts repeated explanations and at least one quarter of excess segments where possible, removes source-reading and graphic-description language, and keeps only the brief qualification needed to state a plan or forecast accurately. Generic disclaimers and evidence inventories stay out of the narration and public description. Keep claim evidence and full caveats in the run record, retain source links in the description, and leave the scheduled Byosan path unchanged.
- Owner instruction 2026-11-23: Interactive Byosan thumbnails use a textless story image. The title carries the verified facts; the image creates curiosity through one clear visual moment. Do not reuse a title overlay, metric card, chart, logo, or explanatory label in that image. Keep this separate from the scheduled thumbnail path.
- Missing credentials (for example `config/.env.yawa`) stop the run and are reported as blocked; agents do not create or fetch them.
- Publication is VERIFIED only after remote receipt and read-back.
- Each run's `publish/state.json` is the canonical publication state; checkpoints and other records do not duplicate the publication result.
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

Yawa, Humanity, and Byosan create new work through the shared model router in `src/io/creative.ts`. Its defaults and automatic cross-provider failover chains are configured in `config/creative_authoring.yaml`: `title` tries `codex:gpt-6-luna:low` then fails over to `agy:gemini-4-hydrogen-medium`; `draft` tries `codex:gpt-6-luna:medium` then fails over to `agy:gemini-4-hydrogen-medium` on quota/rate-limit/capacity/timeout errors (recording `failover_attempts` in the receipt). For a deliberate one-run override, set `YT3_CREATIVE_TITLE_ROUTE=codex:<model>:<effort>` / `YT3_CREATIVE_DRAFT_ROUTE=codex:<model>:<effort>`, or use `agy:<model>`. Each product keeps its own brief and output format. Research, audio/image generation, JIZURA, editing, and the canonical publication entries remain product-owned.

Humanity creates standalone original songs without a fixed fictional town/story-world canon; each song chooses its own genre, mood, vocal color, and concrete details to move the listener. Its song-specific JIZURA plan names the opening hook, an early lyric clue, a recurring visual motif, and the lyric marker where that motif transforms at the emotional climax; it keeps the rendered project beside the video.

## Byosan prompt and constraint policy

Current Claude models follow prompts closely, so over-specified prompts and stacked checks degrade output. Prompts state the goal and the facts that must hold, not the method. Byosan feature, production, and authenticity audits are recorded for review and do not stop a daily run. Runtime failures that prevent preparation or upload still surface as errors.

Byosan title ideation uses article headlines and the supplied subject. The feature draft is one logical call over the full bodies of the day's new articles and the FactSet baseline, with no intermediate summary stage, using the shared configured draft route. An owner-directed interactive run adds one spoken-humanization edit after that fact-grounded draft. A final title review compares the title critique with the edited feature. Feature, source, and published-source audit findings are saved with the run as diagnostics; structured output and schema parsing still provide the data needed to render.

Scripts and narration across all three products stay focused on the listener's experience. Do not add generic caveats, excuses, evidence inventories, or footnotes as padding; include a qualification only when it changes the viewer's accurate understanding, and keep detailed evidence in the run record.

Owner-directed interactive Byosan runs use a separate run ID suffix `-interactive-<slot>`. After the fact-grounded draft, the interactive path runs one spoken-humanization edit before title review and rendering. It can remove or rewrite narration but cannot change the claim ledger, sources, visual data, or existing numerical values; a non-spoken edit result fails before rendering. The public description omits the claim-by-claim evidence and generic disclaimer while preserving the primary and reference source links.

The remaining Byosan digest uses `llm.backends.digest` (`gemini`, `codex`, or `claude`). When Codex hits a usage or rate limit there, the same digest call is redone on `llm.fallback_backend` within the run and the switch is recorded in `audit/llm_calls.jsonl`; a limit on Claude fails explicitly. Daily feature creation uses the shared configured draft route. Daily publication is mandatory.

## Byosan visuals and titles

Every Byosan video uses the pinned local JIZURA renderer and FFmpeg mux. Routine and interactive runs build deterministic, audio-timed visual cues from the feature specification and TTS chunks; give the story pivot a clear layout or contrast change while keeping Japanese text legible in the light KAFKA SIGNAL palette. Scheduled Byosan thumbnails keep their episode-specific art and exact title overlay. Owner-directed interactive thumbnails use a separate textless story image: one full-bleed scene and a single readable visual tension, with no numbers, charts, cards, or brand overlay. The video title carries the facts; the image supplies the moment that makes a viewer curious.

The former 漫才 role contract was removed on 2026-11-07. Scripts may use either available character or both in the roles that suit the episode.

The visual standard is the KAFKA SIGNAL Design System (owner instruction 2026-11-08): pastel, watercolor and impressionist, one light theme. Colors: Primary `#7BA7E1`, Secondary `#B8A7E6`, Accent `#F7B7C1`, Success `#A8D5BA`, Warning `#FFD8A8`, Neutral `#8FA1B3`. The tokens live in `config/design/foundation.tokens.json`; `bun src/scripts/sync_video_design.ts` writes them into `kafka_visual_system_v1.json` and `byosan_video_system_v1.json`, and text stays in the ink foreground so pastel fills never carry text. The old navy palette, the dark tokens, the pin to `KAFKA2306/design`, and the HEAD-pinned design fixture were removed. The independent canonical repository of KAFKA SIGNAL is UNVERIFIED.

Each episode chooses its own opening, pacing, shape, and ending. Do not require a conclusion-first opening, one designated peak, declarative delivery, or a ban on spoken qualifications. Keep factual claims grounded and explain uncertainty where it helps the viewer understand the evidence.

Feature, production, and authenticity findings remain available as diagnostics. They inform review but do not prescribe a recurring style or block daily publication.

## Shared video rendering

Byosan, Yawa, and Humanity use the pinned local JIZURA 0.13.0 renderer for every video, with no alternate renderer or non-JIZURA fallback. Byosan cues follow its spoken feature; Yawa uses quiet, sparse dialogue cues over the original performance with a restrained emotional turn; Humanity authors a song-specific motif, early lyric clue, and climax transformation over the measured lyric timeline. Each channel keeps its own palette and pacing. FFmpeg muxes the unchanged source audio, and the run's provenance records identify the JIZURA project, source audio, and final video. Each run's `publish/state.json` is the canonical publication state.

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
