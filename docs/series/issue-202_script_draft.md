# Issue #202 video script draft: Goals → Signals → Metrics

Status: editorial script draft only. A schema-shaped episode draft now exists at [`issue-202_episode_draft.json`](issue-202_episode_draft.json), but it contains deliberately unresolved voice/audio paths and is not production-ready. No render or publish gate has run; do not render or publish it as-is.

## Production checkpoint — 2026-10-08

- Research/evidence: saved in `config/evidence/issue_202_goals_signals_metrics_20261007.json`; the dated CI observation and metric plan are in `config/metrics/`. A follow-up Jobs API audit is saved in `config/evidence/issue_202_failure_triage_20261008.json`.
- License evidence: `config/evidence/issue_202_license_review_20261008.json` records the LinkedIn DPH Framework CC BY 4.0 source, README/LICENSE, the attribution plan, and remaining release checks.
- Episode: `issue-202_episode_draft.json` is intended for schema and content-reference audit only. Its audio paths are placeholders; compile/render is deferred until the destination channel and voice are selected and rights are reviewed.
- Script: Jobs API logs identify the immediate failure mode for all 25 failed runs: 20 Biome lint/check failures, 2 TypeScript typecheck failures, 1 unit-test timeout, 1 generated-TSX syntax error in render smoke, and 1 canonical smoke run missing `ffmpeg`. Deeper causal attribution is not asserted.
- Branch clustering: a follow-up read of `head_branch` for all 25 workflow runs found six branch labels; `agent/issue-119-episode-json` accounts for 14 runs (13 Biome failures and one missing-`ffmpeg` failure). This is a branch/run grouping, not a distinct-PR count or causal explanation.
- Metric interpretation: the denominator is 101 workflow runs with `run_attempt=1`, not 101 distinct pull requests; one PR can contribute multiple runs. The metric plan, dated snapshot, and narration state this boundary.
- Verification: earlier `task check:merge` runs passed with 264 tests and 1,004, then 1,011 assertions. The first full check after adding the license ledger caught its formatting; repository formatting fixed it. A recent `task check:merge` passed at 2026-10-08T04:41 UTC: lint, typecheck, repository/product audits, 264 tests, and 1,018 assertions. The focused GSM test passed (4 tests, 53 assertions), and `task productivity:gsm:audit` passed. A fresh canonical `task episode:compile` preflight at 04:41 UTC failed before writing output because `audio/pending-channel-and-voice/hook.wav` does not exist; the output directory remained absent and no substitute audio was created. The current 30-day snapshot at 04:36:05Z is stored in `config/metrics/snapshots/issue_202_ci_30d_20261008_043605.json`; its window, totals, latency, and rate are asserted in the test. This refresh adds one successful run (n=101) without changing the 25 failed-run IDs.
- Release: no #202-specific render or YouTube publication was attempted. The generic CI render smoke is not a render of this episode. The selected channel/profile, voice, and remaining media-asset rights are unresolved; the daily flow may publish only after its configured profile and all rights, QA, and release gates pass.
- Resume point: investigate deeper causes only if source changes and logs establish them; branch clustering alone is not causal evidence. Finalize the LinkedIn attribution card/description, confirm the intended channel/profile and voice plus rights for all remaining assets, create approved narration/audio, run canonical compile/render, and pass QA/release gates before publication.

## Brief

- Audience: software builders and repository maintainers
- Platform: YouTube explainer; approximately 90 seconds
- Goal: show how one real repository decision leads to observable signals and bounded metrics
- Source asset: yt3 CI workflow snapshot for 2026-09-08T04:36:05Z through 2026-10-08T04:36:05Z UTC
- Rights boundary: Issue #202 names the SWE Book, whose CC BY-NC-ND 4.0 notice remains recorded. The production GSM reference is instead the LinkedIn DPH Framework, whose README/LICENSE identify CC BY 4.0; attribution is planned, but this is not complete release clearance.

## Script and visual beats

### 0:00–0:12 — Hook

**Visual:** Large `101 workflow runs (run_attempt=1)` counter; split into `76 success` and `25 failure`.

**Narration:**

「このリポジトリのCI、直近30日で初回runが101件。76件は成功、25件は失敗。じゃあ、CIを速くすれば開発は良くなる？……その前に、何を良くしたいかを決めます。」

### 0:12–0:29 — Goal

**Visual:** Goal card: `安全なフィードバックを、待たせすぎない`.

**Narration:**

「Goalは、変更の結果を安全に、なるべく早く知れること。ここで大事なのは、数字を増やすことじゃなく、数字を見てどんな判断を変えるかです。」

### 0:29–0:45 — Signal

**Visual:** Pull request → CI run → review decision. Highlight the actionable result, not a green badge alone.

**Narration:**

「次にSignal。PRへ、レビューに使えるCI結果が返っているか。速さだけでなく、結果が分かりやすく、失敗を調べられることも見ます。」

### 0:45–1:03 — Metrics

**Visual:** `p95 238秒`, `中央値 126秒`, `76/101 workflow runs (75.2%)`; label `run_attempt=1`, the 30-day UTC window, and that runs—not PRs—are counted.

**Narration:**

「この30日では、CIの作成から完了までのp95が238秒、中央値は126秒。run_attempt=1は101件、76件成功で75.2%。同じPRから複数runがあり得るので、PRごとの成功率ではありません。」

### 1:03–1:18 — Boundary

**Visual:** Two explicit labels: `CIの観測値` / `生産性・品質そのものではない`. Show `main: branch protectionなし` as a small caveat card.

**Narration:**

「ただし、これは開発者の生産性でも、コード品質でもありません。2026年10月8日04:37 UTCの確認では、mainにブランチ保護の必須チェックがありませんでした。CIの数字だけで、安全なマージを証明したことにはならないんです。」

### 1:18–1:30 — Action

**Visual:** Immediate failure modes: `Biome lint/check 20`, `TypeScript 2`, `test timeout 1`, `generated TSX syntax 1`, `ffmpeg missing 1`. Beside them, show `14/25` for `agent/issue-119-episode-json`. Footer: `head_branch run cluster; not a distinct PR or defect count`.

**Narration:**

「失敗25 runを枝名でまとめると、Issue #119系列が14件。14回を14個の不具合とは数えず、まとまりとログを見て次の改善を選びます。」

## Production notes

- Keep every displayed metric labeled with the exact 30-day UTC observation window and sample size.
- The 101 denominator is GitHub Actions workflow runs with `run_attempt=1`, not 101 distinct pull requests; one PR can have multiple runs.
- Do not describe the CI workflow as a required check, merge gate, or direct productivity measure.
- The 25 failures are classified by immediate log evidence: 20 Biome lint/check, 2 TypeScript typecheck, 1 unit-test timeout, 1 generated-TSX syntax error, and 1 missing-`ffmpeg` prerequisite. This does not establish deeper systemic causes; keep that distinction explicit.
- Those 25 failed workflow runs cluster under six `head_branch` labels; the largest is `agent/issue-119-episode-json` with 14 runs. A branch label is not a distinct PR or defect identifier; do not infer causality from the cluster.
- Refresh GitHub Actions data before rendering; do not reuse this snapshot as current data.
- Attribution planned for the video description and closing card: LinkedIn Corporation (2023), work title, source and CC BY 4.0 links, Japanese summary/adaptation notice, and no-endorsement statement.
- Channel-specific voice, visual vocabulary, thumbnail, metadata, canonical `episode.json`, audio, and release-gate checks remain pending channel selection and rights review.

## Sources

- yt3 30-day workflow snapshot: `config/metrics/snapshots/issue_202_ci_30d_20261008_043605.json`
- GitHub Actions workflow runs API: https://docs.github.com/en/rest/actions/workflow-runs
- Software Engineering at Google, Chapter 7: https://abseil.io/resources/swe-book/html/ch07.html
- LinkedIn DPH Framework, Goals, Signals, and Metrics: https://linkedin.github.io/dph-framework/goals-signals-metrics.html (README/LICENSE: CC BY 4.0; Copyright 2023 LinkedIn Corporation).
- CC BY 4.0 deed: https://creativecommons.org/licenses/by/4.0/
- Online-edition license notice: https://abseil.io/resources/swe-book
