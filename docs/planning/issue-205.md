# Issue #205 計画: Series #05「SRE Workbookで改善ループを作る」

親: #200 / 原典: [The Site Reliability Workbook](https://sre.google/workbook/table-of-contents/)

## 問い

測定結果をどう実際の改善行動へつなげるか。

## 原典から確認した事実

確認元: 上記目次（WebFetch で確認）と Chapter 5 Alerting on SLOs（https://sre.google/workbook/alerting-on-slos/ を WebFetch で要約取得。動画台本に使う前に原文と照合する）。

- 目次の関連章: Ch.2 Implementing SLOs、Ch.4 Monitoring、Ch.5 Alerting on SLOs、Ch.9 Incident Response、Ch.10 Postmortem Culture、Ch.16 Canarying Releases。
- alert は burn rate（SLO に対して error budget を消費する速さ）に紐づける。固定のエラー率閾値は、SLO を脅かさない事象でも発火しやすく precision が低い。
- 推奨は multiwindow, multi-burn-rate alert。99.9% SLO の出発点として以下が示されている。

| 重大度 | 長い窓 | 短い窓 | burn rate | 予算消費 |
|---|---|---|---|---|
| Page | 1h | 5m | 14.4 | 2% |
| Page | 6h | 30m | 6 | 5% |
| Ticket | 3d | 6h | 1 | 10% |

- 短い窓は「燃焼がまだ続いているか」の確認用。長い窓の約 1/12 とされる。
- alert は人が行動するための仕組み。Page は数時間以内に予算が尽きる場合、Ticket は翌営業日対応の緩やかな燃焼に使う。
- 同一インシデントで複数通知が出ないよう抑制（suppression）が必要。
- UNVERIFIED: 上記の表の数値は要約由来。原文の表記（窓の名称、単位）は未照合。

## 改善ループの定義

計測 → 閾値 → alert → action → 検証 の 5 段を 1 本で閉じる。

1. 計測: 1 つの SLI を good events / valid events の比率として記録する。
2. 閾値: SLO 目標と burn rate の閾値を config に置く。
3. alert: burn rate が閾値を超えたときだけ発火する。
4. action: 発火に対応する具体的な改善行動を 1 つ定める（例: 失敗の多い provider を一時的に除外、リトライ方針の修正、該当 step の再実行手順の実行）。
5. 検証: 行動後に同じ SLI を再計測し、burn rate が閾値未満に戻ったことを記録する。戻らなければ次の行動へ進む。

## yt3 への当てはめ（実装例 1 件）

対象は既存の pipeline 失敗率（例: news / script / render の step 成功率）を SLI とする改善ループ 1 本。

- 計測: `runs/<run_id>/` の step 結果から成功・失敗を集計する。既存の成果物を読むだけで、新しい計測基盤は作らない。
- 閾値: `config/default.yaml` に SLO と burn rate 閾値を置く。コード内にハードコードしない。
- alert: 短窓・長窓の 2 窓で判定し、Ticket 相当のみ出力する（Page 相当は本シリーズでは扱わない）。
- action: 失敗が閾値を超えた step を、既存の retry 分類（直近 commit 1cc55f8 で追加された preflight / angle-stop の retry policy）に照らして対処する。新しいリトライ機構は作らない。
- 検証: 対処後の run で同じ集計を再実行し、結果を Evidence として保存する。

「alert だけ作って終わる構成」を避けるため、action と検証の出力先（改善行動の記録と再計測結果）を必ず実装に含める。

## 完了条件への対応

- [ ] 改善ループを 1 つ実装例化: 上記の step 失敗率ループ 1 本。実装は本 Issue のスコープ外（本ドキュメントは計画のみ）。
- [ ] alert だけ作って終わる構成を避ける: action と検証の記録を必須出力にする。
- [ ] Evidence 保存: `runs/<run_id>/` 配下に集計結果、発火した alert、行動、再計測結果を保存する。
- [ ] episode 一式と publish gate: 台本・Storyboard・Render・QA を既存 pipeline（Research/Evidence → episode.json → Script → Storyboard → Render → QA → publish gate）に載せる。publish は本計画の範囲外で、明示的な承認が必要。

## 残件（未完了・未確認）

- 本 Issue 時点では実装と動画生成は未着手。
- burn rate 表の原文照合は未完了（UNVERIFIED）。
- 対象 SLI の具体的な閾値（何 % を SLO とするか）は、直近の run 実績を集計してから決める。実績データは未確認。
