# Issue #202 企画: Goals → Signals → Metrics をrepoへ実装する

対象: GitHub Issue #202（親: #200）
原典: Software Engineering at Google, "Measuring Engineering Productivity" (Ciera Jaspan / Riona Macnamara)
https://abseil.io/resources/swe-book/html/toc.html
状態: 計画・内容定義。動画の制作、公開、publish gate の通過は本書の範囲外。

## 1. 問い

「良くしたい」を、測定可能な数字に変換する。
本書は、その変換を yt3 の CI 変更フィードバックに適用した実例を示す。

## 2. 原典の要点

- **測定の前提（トリアージ）**: 測定前に次を答える。期待される結果は何か。結果が良くても悪くても行動につながるか。意思決定者は誰で、どのデータを信頼するか。行動につながらないなら測らない。
- **GSM の役割**:
  - Goal: 達成したい望ましい結果。測定方法には言及しない。
  - Signal: 目標達成の兆候。直接測れないこともある。
  - Metric: Signal の代理指標。実際に測れるもの。
  - 各 Metric から Goal まで辿れること（トレーサビリティ）を保つ。
- **QUANTS**: コード品質、集中（Attention）、知的複雑性、スピード、満足度の5要素。要素同士はトレードオフなので、一つだけ動かして他を悪化させていないか全体で見る。
- **定性と定量の併用**: 定量はスケールと再現性に優れるが理由を説明できない。定性で検証し、食い違えば定量側を疑って調べ直す。
- **アンチパターン**: 街灯効果（測りやすいものだけ見る）、虚栄指標（決定済みの施策の正当化に使う）、結果に合わせた後出しの指標変更、LOC のような目的を捉えない代理指標。
- **Goodhart 的な歪み**: 生産性指標を個人評価に使うと操作が始まる。測定対象は個人ではなく集団の傾向とする。

出典の確認: 本書は原典の章（Measuring Engineering Productivity）の要点を2026-10-10に取得した本文から要約した。公開日は本文に記載がなく UNVERIFIED。

## 3. Goals → Signals → Metrics の実装例（yt3）

実装ファイル: `config/metrics/issue_202_goals_signals_metrics.json`（schema_version 1）
判断: 「どのように本当にフィードバックを速く、信頼できるものにするか」

| 層 | ID | 内容 |
|---|---|---|
| Goal | `trustworthy-feedback` | 変更は、既存の安全チェックを弱めずに、適時で解釈可能な CI 結果を受け取る |
| Signal | `actionable-check-feedback` | PR が、レビューに間に合う時点で実行可能な CI 結果を受け取る |
| Signal | `ci-outcome` | 初回の CI 試行が、失敗の切り分けに使える明示的な結果を返す |
| Metric | `ci-workflow-p95-latency` | PR の CI 実行の作成から完了までの経過時間の p95（秒） |
| Metric | `ci-first-attempt-pass-rate` | `run_attempt = 1` の完了実行のうち success の割合（%） |

現在の計測値（観測窓 2026-09-08〜2026-10-08 UTC、GitHub Actions run API 由来）:

- `ci-workflow-p95-latency`: 238 秒（n=102、中央値 125.5 秒、最大 2892 秒）
- `ci-first-attempt-pass-rate`: 75.5%（77 / 102 実行）

各 Metric の `limitations` に、次を明記している。
- 実行時刻は代理指標であり、キュー待ちやサービス側の遅延を含む。
- 「緑の CI」は欠陥のなさを証明しない。
- 観測対象の CI は branch protection の必須チェックではない。
- 件数は PR 数ではなく実行数であり、同一 PR の複数実行を数える。
- 中止・スキップ・インフラ失敗は成功にも失敗にも黙って混ぜない。
- 前後比較は記述的であり、特定の施策の因果を示さない。

## 4. yt3 で使える評価指標の候補

すべて候補であり、データ源と閾値を確定したものだけを MEASURED とする。未計測のものは UNVERIFIED。

| 候補 | QUANTS 要素 | 測定の源 | 状態 |
|---|---|---|---|
| CI p95 経過時間 | スピード | GitHub Actions run API | MEASURED（上記） |
| 初回試行の成功率（分母を明示） | 品質 / 結果の明確さ | GitHub Actions run API | MEASURED（上記） |
| キャンセル・スキップ・インフラ失敗の比率 | 結果の明確さ | GitHub Actions run API | UNVERIFIED（定義のみ） |
| 同一 PR の再実行回数 | 集中 / 安定性 | GitHub Actions run API | UNVERIFIED |
| 人手で差し戻したテイク数 / 公開前の修正回数 | 品質 | repo の監査・runs 記録 | UNVERIFIED |
| 公開後の視聴維持率 | 満足度に近い代理 | 公開先の分析 | UNVERIFIED（公開データ未取得） |

判定の順序: 先に Goal と意思決定を置き、そのあとで Metric を選ぶ。計測しやすさから選ばない。

## 5. 指標だけ増やすアンチパターン

- 指標を増やしても、どの Goal に繋がるか説明できないものは残さない。
- 1 つの指標が悪化したとき、別の指標を後から探して都合の良いものだけ採らない。事前に決めた指標で判断し、変更は記録する。
- 指標の数はダッシュボードの見た目ではなく、判断に使われた回数で評価する。
- 閾値の緩和で通すのは、Goal の見直しとして記録したうえで行う。指標を消して通すことはしない。
- 測定を理由に安全チェックを弱めない。CI の全ゲートを残したまま高速化を検討する。

## 6. 完了条件に対する現状

| 条件 | 状態 | 根拠 |
|---|---|---|
| Goal / Signal / Metric を最低1セット実装例化 | 達成 | `config/metrics/issue_202_goals_signals_metrics.json`、main 統合済み（merge commit `fee5019609884a92dbd0665f62a102f2fad40b34`、Issue 本文の記載） |
| 指標だけ増やすアンチパターンの説明 | 達成 | 本書 §5 |
| 一次ソース根拠の保存 | 達成 | 本書 §2 と上記 JSON の `sources`（原典 URL、取得日） |
| publish gate 通過 | 未達 | Issue 本文どおり。canonical compile が `docs/series/audio/pending-channel-and-voice/hook.wav` の不在で失敗、チャンネル profile・声・素材の権利確認も未解決 |

## 7. 残件

- 動画の compile 失敗の解消（`hook.wav` の用意、または正本の修正）。ソースの修正は別作業で行う。
- チャンネル profile、声、素材の権利確認。
- 本番レンダーと動画 QA。
- publish gate の通過確認後に、Issue #202 の最後のチェックを更新する。公開そのものは別途の明示的な承認が必要。

本書は publish を行っていない。Issue のクローズ、コメント投稿、外部公開は行わない。
