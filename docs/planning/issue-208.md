# Issue #208 計画: Series #08「repoを数字で評価して自動改善する」

親: #200 / 対象: yt3 リポジトリ `/home/kafka/2511youtuber/v3/yt3`
状態: 計画のみ。動画の制作・公開・外部投稿は行っていない。

## 1. 問い

シリーズ全体（#01〜#07 の考え方）を、実際の自動改善 pipeline へどう統合するか。

## 2. 既存資産の確認（yt3 のリポジトリ内で確認した事実）

| 資産 | 場所 | 役割 |
| --- | --- | --- |
| Goals/Signals/Metrics 定義 | `config/metrics/issue_202_goals_signals_metrics.json` | 目的・信号・指標を JSON で保持 |
| GSM 監査 | `src/scripts/audit_goals_signals_metrics.ts`（`check:merge:fast` から実行） | 定義の整合性を merge gate で検査 |
| 安定性レポート | `task stability:report`（`src/scripts/stability_summary.ts`） | 日次 run の証跡充足と成功率を集計 |
| 改善レポート | `task improve:report`（`src/scripts/improve_report.ts`） | 7日・30日窓の成功率と不足 evidence を出力 |
| merge gate | `task check:merge:fast` / `task check:merge`、CI は同一ゲート | repository acceptance |
| リポジトリ契約監査 | `task audit:repo-contract` | Taskfile と文書化された入口の整合 |
| 週次研究 workflow | `.github/workflows/weekly-repo-research.yml`（毎週土曜 08:23 JST） | 定期実行の既存枠（中身は外部 reusable workflow。詳細は UNVERIFIED） |
| 品質ゲートの分離 | `docs/QUALITY_GATES.md` | repository acceptance / product release / external verification を分けて判定 |

既存の不足: 閾値（threshold）を置く設定ファイルは見当たらない。改善候補を生成する処理も、`improve:report` は集計のみで候補は出さない。

## 3. 8段階 flow（1本の流れとして示す）

| # | 段階 | yt3 での具体物 | 出力（evidence） |
| --- | --- | --- | --- |
| 1 | Goals | 「変更が早く、かつ既存の安全ゲートを弱めずに信頼できるフィードバックを得る」（既存 goal `trustworthy-feedback`） | goal id |
| 2 | Signals | PR が早期に actionable な CI 結果を得る、最初の試行で明確な outcome が出る（既存 signal 2 件） | signal id と `measurement_state` |
| 3 | Metrics | CI workflow p95 経過時間、first-attempt 成功率 など（GitHub Actions run API から取得） | metric 定義と取得元 URL |
| 4 | threshold | 指標ごとに「許容値」と「見直し条件」を置く。値は仮置きで、過去 run の実測で確定する（UNVERIFIED） | `config/metrics/` 配下の閾値定義 |
| 5 | CI / scheduled audit | merge gate は PR ごと、`stability:report` / `improve:report` は定期実行。既存の週次 workflow 枠を流用 | 実行 run の URL と成果物 |
| 6 | 改善候補生成 | threshold を外れた metric と、その signal・goal を紐付けた候補リストを出す | 候補 JSON（run id 付き） |
| 7 | 修正 | 候補ごとに 1 PR。`task check:merge:fast` を通し、安全ゲートは削除・緩和しない | PR 番号と merge gate 結果 |
| 8 | 再計測 | 修正後の同じ metric を同じ窓で再取得し、前後の差分を記録 | 前後比較レポート |

流れ: `Goals → Signals → Metrics → threshold → CI/scheduled audit → 改善候補 → 修正 → 再計測 → Goals`

## 4. 実 repo で使える最小構成（提案）

新規ファイルは増やさず、既存の入口に載せる。

1. `config/metrics/` に閾値を追記する（段階 4）。metric id は既存 JSON の `metrics[].id` を再利用する。
2. `improve:report` の出力に「閾値超過の metric」だけを抽出するフィールドを足す（段階 6）。判断ロジックは TypeScript の既存スクリプトへ寄せ、別スクリプトは作らない。
3. 週次の `stability:report` と `improve:report` を既存の定期実行に載せる（段階 5）。
4. 修正（段階 7）は人間が候補を選んで PR にする。自動 merge はしない。merge は `docs/QUALITY_GATES.md` の条件を満たした場合だけ。

この構成でやらないこと: 閾値の自動緩和、gate の自動スキップ、候補の自動 merge、外部投稿。

## 5. Evidence 保存

- 各 run の評価結果は `runs/` 配下の run 単位に保存し、run id で追跡できるようにする。
- 再計測（段階 8）の前後比較は、比較元と比較先の run id・取得時刻・取得元 URL を必ず含める。
- 数値だけを書いた要約は証跡として扱わない。

## 6. episode 一式と publish gate

- episode 一式は既存 pipeline（Research/Evidence → `episode.json` → Script → Storyboard → Render → QA → publish gate）へ載せる。
- 公開は外部への不可逆な副作用であり、本計画では実行しない。公開は別途の明示的な承認を待つ。
- 本 Issue の完了条件は「episode 一式が publish gate の入力まで揃うこと」で、公開完了ではない。

## 7. シリーズ全体への導線（description 用の文案）

本 Issue の完了条件には「description へのシリーズ導線追加」が含まれる。文案:

> 本作は「無料公開ソフトウェア工学本で学ぶ、repoを数字で評価する方法」シリーズ（全8回）の最終回です。#01 なぜ数字で測るのか からご覧いただけます。

（シリーズ一覧 URL は未確定のため、公開時に埋める。UNVERIFIED）

## 8. 完了条件の対応状況

| 完了条件 | 状態 | 根拠・残件 |
| --- | --- | --- |
| 8 段階を 1 本の flow として示す | 本書で達成（§3） | 段階 4 の閾値値は未確定 |
| 実 repo で使える最小構成を提示 | 本書で提示（§4） | 未実装。閾値ファイルと候補抽出は未作成 |
| Evidence 保存 | 方針のみ（§5） | 保存先の実装と実 run は未実施 |
| episode 一式と publish gate | 未着手 | episode.json 等は未作成。公開は承認待ち |
| シリーズ全体への導線を description へ追加 | 文案のみ（§7） | GitHub 上の description は未変更（本作業では外部操作をしていない） |

## 9. UNVERIFIED / 未完了

- 閾値の具体値: 過去 run の実測がないため未確定。
- 週次 workflow の中身: 外部 reusable workflow のため、本 repo 内からは処理内容を確認できていない。
- CI p95 などの実測値: 本計画では取得していない。
- 原典（SRE 本など）の章立て: 本書では扱わない。Issue #200 の確認範囲に従う。
- GitHub Issue #208 の本文チェックボックスと description の更新は、外部への書き込みのため未実施。
