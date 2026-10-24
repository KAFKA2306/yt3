# Ledger Standard

## Purpose

A ledger is the record of what happened: state transitions, failures, decisions, and external side effects, each with time and a hash. The ledger is the evidence layer. Analysis is built from it in the [star schema](./star-schema-standard.md), and meaning is defined by the [ontology](./ontology-standard.md).

## Rules

1. **One canonical ledger per fact.** A fact is recorded in one place. Other views are derived from it, never written separately.
2. **Append-only.** Entries are added, not edited or deleted. A correction is a new entry that references the one it corrects.
3. **Every entry is traceable.** Each entry carries a timestamp, the run or profile it belongs to, the code revision (`git` HEAD) that produced it where applicable, and a hash of its payload where it is an artifact.
4. **Current state is a projection.** "Current" is derived from the latest entries and is never the only record.
5. **External side effects need a receipt.** A publish, schedule, or delete is recorded as an attempt, followed by a read-back entry. Without the read-back, the state is UNVERIFIED.

## Ledgers in this repository

| ledger | canonical location | records | status |
|---|---|---|---|
| Run ledger | `runs/<profile>/<run-id>/` (`research/`, `source/`, `audit/`, `publish/`) | each production execution and its artifacts | VERIFIED: directories exist |
| Run table | `db/schema.sql` `runs`, `raw_artifacts` | run lifecycle and artifact hashes | VERIFIED: table defined |
| Failure ledger | `runs/byosan_money/<date>-daily/audit/failure_trace.json` | failure class, stage, fingerprint, retry policy, repair resolution | VERIFIED: file written on failure |
| Publication state | `src/domain/publication_state.ts` (`CanonicalPublicationStateSchema`) | canonical publish state per run | VERIFIED: schema exists |
| Analytics | `db/schema.sql` `youtube_analytics` | API-measured metrics, 30-day window | VERIFIED: table defined |
| LLM quota | `data/state/llm_quotas.json` (`src/io/utils/quota/ledger.ts`) | quota usage per key | VERIFIED: path in code |
| Yawa run ledger | `runs/yawa_archive/<run-id>/` (`selection.json`, `script.json`, `reference.json`, `tts.json`, `audit/result.json`, `publish/`) | each yawa episode: pool pick, script, voice reference, TTS record, audit, publish state and receipt | VERIFIED: directories exist |
| Yawa daily logs | `logs/yawa_daily.log`, `logs/yawa_validate.log` | scheduled production and daily validation outcomes | VERIFIED: written by the systemd timers |

## Known deviations (UNVERIFIED against the rules above)

- The failure ledger is overwritten on each new failure with the same fingerprint. Rule 2 is not met yet. Target: append each occurrence as an entry, and keep the current status as a projection.
- The run ledger and the run table are not yet linked by a shared run identifier. Target: `runs/<run-id>` is the key in both.
- Whether every publish attempt writes a read-back entry is not verified for all profiles.
- Yawa: the daily timer re-prepared an already published run (`yawa-2026-10-23`). See Correction C-1 below. PR #322 stops this for published and pre-reference runs.

## Corrections (append-only)

- **C-1 (yawa-2026-10-23).** After publication, the 20:30 JST daily run re-prepared `runs/yawa_archive/yawa-2026-10-23`. It added `reference_sha256` to `tts.json` and `voice_reference: PASS` to `audit/result.json`, but the audio had been generated caption-only. The video was not re-uploaded (`IDEMPOTENT_REUSE`). Correction: the field and check were removed, the post-hoc reference files were deleted, and the validation was re-run and passed. Guard: `preparationAction` in PR #322. Status: corrected; the original entries are kept in the git history.
- **C-2 (E-2026-10-24-01).** The event cites PR #328 for the tag-set check. #328 was closed when its branch was deleted and was not merged. The change was re-opened as PR #329 and merged; `main` contains it. The rewrite itself was run with that change before the merge.

## Events (append-only)

Each event is recorded in the run it belongs to. The entry here points to that record and does not copy it (rule 1).

- **E-2026-10-24-01 (metadata rewrite, four yawa episodes).** Titles, descriptions and tags were rewritten to the current rules with `task yawa:metadata`, then read back from YouTube. Each run has `publish/metadata_updates.jsonl`. Result: verified for `7pRW25gkZlg`, `9JYWuZXABhQ`, `KRWpvyY45iI`, `qWUjjJv_LdQ`.
  - The first attempt reported a mismatch for all four. The cause was the tag order returned by YouTube, not the content. The check was changed to compare tags as a set (PR #328; see C-2). The failed attempt stays in the same file as a separate line.
- **E-2026-10-24-02 (SEO metadata rule).** The title and description standard changed to include the search prefix and the content sentence, per `docs/standard/asmr-workflow.md` step 10 and 16 (PR #326, #327).
- **E-2026-10-24-03 (byosan daily timer).** `yt3-automation.timer` is disabled; its last automatic run was 2026-10-12. The user unit `yt3-byosan-daily.timer` (`systemd/yt3-byosan-daily.timer`, 09:00 JST daily) is enabled. State: enabled. First scheduled run 2026-10-25 09:00 JST; run result UNVERIFIED.
- **E-2026-10-24-04 (source registry).** The canonical registry is `config/sources/byosan_discovery_sources.json` (12 entries). The original Google Sheets could not be imported (Drive connector authentication error, anonymous fetch returned 401). Any rows that exist only in the sheet are UNVERIFIED.
- **E-2026-10-24-05 (contact sent to an external service).** During a source-fetch survey of SEC, the owner's contact address was sent once as the User-Agent. It was not published. From this point, contact details are not sent to external services. The address itself is not recorded in this ledger.
- **E-2026-10-24-06 (experiment data deleted).** `sandbox/oss-bakeoff/` (`ace-step`, `hf-home`, `flux-venv`) and `scratch/` (about 38 GB in total) were deleted after confirming nothing references them. They are git-ignored and not tracked, so they cannot be restored.
- **E-2026-10-24-07 (byosan publication, run `byosan_money/2026-10-24-daily`).** The run was published once through the canonical path `task publish PROFILE=byosan -- byosan_money/2026-10-24-daily`. Video `5grzsyKLesU` (channel 秒算マネー, privacy public, length PT7M42S, processing succeeded). Evidence: `publish/receipt.json`, `publish/state.json` (phase VERIFIED), `publish/visibility_attestation.json`, `publish/thumbnail_attestation.json`.
  - Release gate (command output for the same run): `[product-release-gate] PASS profile=byosan run=byosan_money/2026-10-24-daily artifact_sha256=5e0abdfc067960948ad05b68761813a4fda3df91722c463a6abe53d2c07ece56`, with `PUBLISH_READY_RUN` and `PUBLISH_COMMAND` for the same run.
  - Read-back: the run's `visibility_attestation.json` (current privacy public) and an operator's YouTube API read of title, length and processing. Two values are not yet reconciled with the run files: the receipt records `published_at` 2026-10-24T11:57:57Z while the API read reported 12:01Z, and the run metadata has 9 tags while the API read reported 13. Both stay UNVERIFIED until the same field is read back and matched.
- **E-2026-10-24-08 (nature of the factual integrity check).** `audit/result.json` records `factual_integrity` as PASS: every claim links to a declared source and the explanation figures match the script. The check is deterministic and written by the pipeline itself. It is not an independent third-party audit.
- **E-2026-10-24-09 (daily timer, first run).** E-2026-10-24-03 still applies. The publication in E-2026-10-24-07 was manual and is not a timer run. `systemctl --user is-enabled yt3-byosan-daily.timer` returns `enabled`, and `list-timers` shows NEXT 2026-10-25 09:00 JST and LAST n/a. The first timer run result is UNVERIFIED.
- **E-2026-10-24-10 (LLM quota limits).** The Gemini free tier reached its quota today: HTTP 429 `generate_content_free_tier_request`, recorded as `PROVIDER_RATE_LIMIT` in `audit/preflight_gemini_attempts.json`. The codex usage limit lasted until 18:10 JST (reported by the operator; no evidence file linked yet). Both are single points of failure for the daily run (Issue #338).

## Retention

- Ledger entries are kept. Archival moves them to `docs/archive/` or an archive directory; it never deletes them.
- The one exception is the analytics window in the [star schema standard](./star-schema-standard.md): data past the 30-day authorization boundary is purged as required by policy.
