# Issue #202 video script draft: Goals → Signals → Metrics

Status: editorial script draft only. A schema-shaped episode draft now exists at [`issue-202_episode_draft.json`](issue-202_episode_draft.json), but it contains deliberately unresolved voice/audio paths and is not production-ready. No render or publish gate has run; do not render or publish it as-is.

## Production checkpoint — 2026-10-07

- Research/evidence: saved in `config/evidence/issue_202_goals_signals_metrics_20261007.json`; the dated CI observation and metric plan are in `config/metrics/`.
- Episode: `issue-202_episode_draft.json` is intended for schema and content-reference audit only. Its audio paths are placeholders; compile/render is deferred until the destination channel and voice are selected and rights are reviewed.
- Script: this file contains the narration and proposed visual beats. The 25 failures are not classified; the displayed categories are hypotheses, not measured counts.
- Verification: the episode schema/content audit and `task productivity:gsm:audit` passed. `task check:merge` passed (including lint, typecheck, repository/product audits, and 264 tests). Its first run caught JSON formatting only; the formatter was applied and the full check rerun successfully. Canonical compile/render were deliberately not attempted because the audio paths are placeholders.
- Release: not authorized from this two-hour improvement loop. Daily publication remains a separate automation and must still pass its configured channel, rights, and QA gates.
- Resume point: confirm the intended channel/profile and rights-cleared source or permission. Then refresh the dated repository observations, finalize the episode, create approved narration/audio, compile/render, run QA/release gates, and leave publication to the dedicated daily flow.

## Brief

- Audience: software builders and repository maintainers
- Platform: YouTube explainer; approximately 90 seconds
- Goal: show how one real repository decision leads to observable signals and bounded metrics
- Source asset: yt3 CI workflow snapshot for 2026-09-07T09:57:03Z through 2026-10-07T09:57:03Z
- Rights boundary: original narration based on yt3's own observed data. No source text is quoted. The cited Software Engineering at Google chapter has a CC BY-NC-ND 4.0 notice; rights review or a different cleared source is still required before publication.

## Script and visual beats

### 0:00–0:12 — Hook

**Visual:** Large `88` counter; split into `63 success` and `25 failure`.

**Narration:**

「このリポジトリのCI、30日で88回。初回成功は63回、失敗は25回。じゃあ、CIを速くすれば開発は良くなる？……その前に、何を良くしたいかを決めます。」

### 0:12–0:29 — Goal

**Visual:** Goal card: `安全なフィードバックを、待たせすぎない`.

**Narration:**

「Goalは、変更の結果を安全に、なるべく早く知れること。ここで大事なのは、数字を増やすことじゃなく、数字を見てどんな判断を変えるかです。」

### 0:29–0:45 — Signal

**Visual:** Pull request → CI run → review decision. Highlight the actionable result, not a green badge alone.

**Narration:**

「次にSignal。PRへ、レビューに使えるCI結果が返っているか。速さだけでなく、結果が分かりやすく、失敗を調べられることも見ます。」

### 0:45–1:03 — Metrics

**Visual:** `p95 159秒`, `中央値 124秒`, `初回成功率 71.6% (63/88)`; label the 30-day UTC window.

**Narration:**

「この30日では、CIの作成から完了までのp95が159秒、中央値は124秒。初回成功率は63割る88で71.6%。これはGitHub ActionsのCIワークフローを測った値です。」

### 1:03–1:18 — Boundary

**Visual:** Two explicit labels: `CIの観測値` / `生産性・品質そのものではない`. Show `main: branch protectionなし` as a small caveat card.

**Narration:**

「ただし、これは開発者の生産性でも、コード品質でもありません。2026年10月7日12:41 UTCの確認では、mainにブランチ保護の必須チェックがありませんでした。CIの数字だけで、安全なマージを証明したことにはならないんです。」

### 1:18–1:30 — Action

**Visual:** Failure triage buckets: `テスト`, `コード`, `基盤`; keep all checks visible.

**Narration:**

「次の一手は、失敗25件を原因別に調べること。カバレッジを削って数字だけ良くするのは逆効果。GoalからSignal、Metricへ。数字は、次の判断に結びついて初めて役に立ちます。」

## Production notes

- Keep every displayed metric labeled with the exact 30-day UTC observation window and sample size.
- Do not describe the CI workflow as a required check, merge gate, or direct productivity measure.
- The 25 failures have not yet been classified; the three buckets are proposed follow-up work, not observed counts.
- Refresh GitHub Actions data before rendering; do not reuse this snapshot as current data.
- Channel-specific voice, visual vocabulary, thumbnail, metadata, canonical `episode.json`, audio, and release-gate checks remain pending channel selection and rights review.

## Sources

- yt3 30-day workflow snapshot: `config/metrics/snapshots/issue_202_ci_30d_20261007.json`
- GitHub Actions workflow runs API: https://docs.github.com/en/rest/actions/workflow-runs
- Software Engineering at Google, Chapter 7: https://abseil.io/resources/swe-book/html/ch07.html
- Online-edition license notice: https://abseil.io/resources/swe-book
