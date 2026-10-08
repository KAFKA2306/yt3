# Issue #202 video script draft: Goals → Signals → Metrics

Status: editorial script draft only. A schema-shaped episode draft now exists at [`issue-202_episode_draft.json`](issue-202_episode_draft.json), but it contains deliberately unresolved voice/audio paths and is not production-ready. No render or publish gate has run; do not render or publish it as-is.

## Production checkpoint — 2026-10-08

- Research/evidence: saved in `config/evidence/issue_202_goals_signals_metrics_20261007.json`; the dated CI observation and metric plan are in `config/metrics/`. A follow-up Jobs API audit is saved in `config/evidence/issue_202_failure_triage_20261008.json`.
- Episode: `issue-202_episode_draft.json` is intended for schema and content-reference audit only. Its audio paths are placeholders; compile/render is deferred until the destination channel and voice are selected and rights are reviewed.
- Script: Jobs API logs identify the immediate failure mode for all 25 failed runs: 20 Biome lint/check failures, 2 TypeScript typecheck failures, 1 unit-test timeout, 1 generated-TSX syntax error in render smoke, and 1 canonical smoke run missing `ffmpeg`. Deeper causal attribution is not asserted.
- Branch clustering: a follow-up read of `head_branch` for all 25 workflow runs found six branch labels; `agent/issue-119-episode-json` accounts for 14 runs (13 Biome failures and one missing-`ffmpeg` failure). This is a branch/run grouping, not a distinct-PR count or causal explanation.
- Metric interpretation: the denominator is 88 workflow runs with `run_attempt=1`, not 88 distinct pull requests; one PR can contribute multiple runs. The metric plan, evidence note, and narration now state this boundary.
- Verification: the episode schema/content audit (6 sections, 11 dialogue units) and `task productivity:gsm:audit` passed. On 2026-10-08T00:34Z, `task check:merge` passed: lint, typecheck, repository/product audits, and 264 tests with 1,004 assertions. An initial run caught formatting in the new evidence/episode/test files; targeted formatting was applied before the passing rerun. Canonical compile/render were deliberately not attempted because the audio paths are placeholders.
- Release: not authorized from this two-hour improvement loop. Daily publication remains a separate automation and must still pass its configured channel, rights, and QA gates.
- Resume point: investigate deeper causes only if source changes and logs establish them; branch clustering alone is not causal evidence. Refresh the dated repository observations and confirm the intended channel/profile and rights-cleared source or permission. Then finalize the episode, create approved narration/audio, compile/render, run QA/release gates, and leave publication to the dedicated daily flow.

## Brief

- Audience: software builders and repository maintainers
- Platform: YouTube explainer; approximately 90 seconds
- Goal: show how one real repository decision leads to observable signals and bounded metrics
- Source asset: yt3 CI workflow snapshot for 2026-09-07T09:57:03Z through 2026-10-07T09:57:03Z
- Rights boundary: original narration based on yt3's own observed data. No source text is quoted. The cited Software Engineering at Google chapter has a CC BY-NC-ND 4.0 notice; rights review or a different cleared source is still required before publication.

## Script and visual beats

### 0:00–0:12 — Hook

**Visual:** Large `88 workflow runs (run_attempt=1)` counter; split into `63 success` and `25 failure`.

**Narration:**

「このリポジトリのCI、30日で1回目のworkflow runが88件。63件が成功、25件が失敗。じゃあ、CIを速くすれば開発は良くなる？……その前に、何を良くしたいかを決めます。」

### 0:12–0:29 — Goal

**Visual:** Goal card: `安全なフィードバックを、待たせすぎない`.

**Narration:**

「Goalは、変更の結果を安全に、なるべく早く知れること。ここで大事なのは、数字を増やすことじゃなく、数字を見てどんな判断を変えるかです。」

### 0:29–0:45 — Signal

**Visual:** Pull request → CI run → review decision. Highlight the actionable result, not a green badge alone.

**Narration:**

「次にSignal。PRへ、レビューに使えるCI結果が返っているか。速さだけでなく、結果が分かりやすく、失敗を調べられることも見ます。」

### 0:45–1:03 — Metrics

**Visual:** `p95 159秒`, `中央値 124秒`, `63/88 workflow runs (71.6%)`; label `run_attempt=1`, the 30-day UTC window, and that runs—not PRs—are counted.

**Narration:**

「この30日では、CIの作成から完了までのp95が159秒、中央値は124秒。run_attempt=1は88件、63件成功で71.6%。同じPRから複数runがあり得るので、PRごとの成功率ではありません。」

### 1:03–1:18 — Boundary

**Visual:** Two explicit labels: `CIの観測値` / `生産性・品質そのものではない`. Show `main: branch protectionなし` as a small caveat card.

**Narration:**

「ただし、これは開発者の生産性でも、コード品質でもありません。2026年10月7日12:41 UTCの確認では、mainにブランチ保護の必須チェックがありませんでした。CIの数字だけで、安全なマージを証明したことにはならないんです。」

### 1:18–1:30 — Action

**Visual:** Immediate failure modes: `Biome lint/check 20`, `TypeScript 2`, `test timeout 1`, `generated TSX syntax 1`, `ffmpeg missing 1`. Beside them, show `14/25` for `agent/issue-119-episode-json`. Footer: `head_branch run cluster; not a distinct PR or defect count`.

**Narration:**

「失敗25 runを枝名でまとめると、Issue #119系列が14件。14回を14個の不具合とは数えず、まとまりとログを見て次の改善を選びます。」

## Production notes

- Keep every displayed metric labeled with the exact 30-day UTC observation window and sample size.
- The 88 denominator is GitHub Actions workflow runs with `run_attempt=1`, not 88 distinct pull requests; one PR can have multiple runs.
- Do not describe the CI workflow as a required check, merge gate, or direct productivity measure.
- The 25 failures are classified by immediate log evidence: 20 Biome lint/check, 2 TypeScript typecheck, 1 unit-test timeout, 1 generated-TSX syntax error, and 1 missing-`ffmpeg` prerequisite. This does not establish deeper systemic causes; keep that distinction explicit.
- Those 25 failed workflow runs cluster under six `head_branch` labels; the largest is `agent/issue-119-episode-json` with 14 runs. A branch label is not a distinct PR or defect identifier; do not infer causality from the cluster.
- Refresh GitHub Actions data before rendering; do not reuse this snapshot as current data.
- Channel-specific voice, visual vocabulary, thumbnail, metadata, canonical `episode.json`, audio, and release-gate checks remain pending channel selection and rights review.

## Sources

- yt3 30-day workflow snapshot: `config/metrics/snapshots/issue_202_ci_30d_20261007.json`
- GitHub Actions workflow runs API: https://docs.github.com/en/rest/actions/workflow-runs
- Software Engineering at Google, Chapter 7: https://abseil.io/resources/swe-book/html/ch07.html
- Online-edition license notice: https://abseil.io/resources/swe-book
