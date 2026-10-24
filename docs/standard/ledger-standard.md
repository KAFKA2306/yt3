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

## Retention

- Ledger entries are kept. Archival moves them to `docs/archive/` or an archive directory; it never deletes them.
- The one exception is the analytics window in the [star schema standard](./star-schema-standard.md): data past the 30-day authorization boundary is purged as required by policy.
