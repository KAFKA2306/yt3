# Issue #204 企画: Series #04 監視で見るべき数字を絞る

対象: GitHub Issue #204（親: #200）
状態: 企画定義のみ。動画の制作・公開は行っていない。

## 1. 問いと結論

- 問い: ログやメトリクスを増やし続けず、何を見るべきか。
- 結論: 見る数字は Google SRE の4つの golden signals（latency / traffic / errors / saturation）に絞る。各指標は repo・サービス・自動化の単位に翻訳し、「測っているが判断できない」状態を避ける。

## 2. 原典

- Google SRE book, Chapter 6 "Monitoring Distributed Systems"
- URL: https://sre.google/sre-book/monitoring-distributed-systems/
- 到達確認: 2026-10-10 に WebFetch で本文を取得（本節の定義はこの取得結果に基づく）。
- UNVERIFIED: 動画で引用する場合の利用許諾・ライセンス表記。Evidence 保存時に確認する。
- 原典の定義（要旨、取得結果の引用）:
  - Latency: 「リクエストの処理にかかる時間」
  - Traffic: システムにかかっている需要の量。システム固有の高レベル指標で測る
  - Errors: 失敗したリクエストの割合（明示的な失敗、暗黙的・方針上の失敗の両方）
  - Saturation: サービスがどれだけ「満杯」か
- 原典の運用方針: 4指標を測り、いずれかが問題のとき（saturation は「問題に近づいたとき」）に人を呼ぶ。これで多くのサービスは最低限カバーできる。

## 3. 4指標の説明（具体例つき）

| 指標 | 一言で | Web サービスでの例 | yt3 での例（提案・要存在確認） |
|---|---|---|---|
| latency | 処理にかかる時間 | API の p95 応答時間 | 1 run の step 所要時間（例: research, render）。成功と失敗を分けて測る |
| traffic | どれだけ需要があるか | 毎秒リクエスト数 | 1 日の run 数、外部 API（Gemini / Perplexity）呼び出し数 |
| errors | 失敗の割合 | 5xx の割合 | step 失敗率、product-release-gate の FAIL 率、音声生成の失敗率 |
| saturation | どれだけ詰まっているか | CPU、メモリ、キュー長 | API クォータ残量、ディスク使用率、Voicevox / Discord bot の常駐状態 |

注記:
- yt3 の具体的なメトリクス名・保存先は未確認。実装前に `runs/<run_id>/` 配下のログ構造と `task status` の出力で存在を確認する。存在しない指標は「追加する」か「捨てる」かを決める。
- Aim は既存の可視化基盤として使えるか未確認（AGENTS.md に記載あり）。

## 4. 「測っているが判断できない」状態を避ける規則

各指標について次の4点を揃える。1つでも欠けたら、その指標は監視対象にしない。

1. 判断: 見たときに何をするか（放置 / 調査 / 停止 / 再実行）を1つ決める
2. 閾値: 正常と異常の境界を数値で書く（config/ に置く。ハードコーディング禁止）
3. 単位: 1 run、1 step、1 日、1 サービスのどれで測るかを決める
4. 根拠: 数値の出所（ファイル、コマンド、CI）を記録する

数字が増えすぎたら削る。4指標以外は、4指標のどれかで説明できる場合だけ残す。

## 5. repo / service / automation への翻訳

- repo: 「コードの変更頻度（traffic）」「CI の失敗率（errors）」「CI 所要時間（latency）」を見る。
- service: 常駐サービス（Aim、Voicevox、Discord bot）の応答時間、失敗率、資源使用率を見る。
- automation: cron / scheduled 実行の成功率、実行時間、直近の未完了 run 数を見る。自動化は人が見ないため、失敗を検知して通知する閾値を先に決める。

## 6. よくある誤用（動画で扱う）

- 指標を増やして安心する（ダッシュボードだけ増える）
- 平均値だけを見る（p95 / p99 や失敗の内訳を見ない）
- 閾値なしで眺める（判断に結びつかない）
- 4指標で足りるのに CPU やログ行数を並べる

## 7. 制作・公開に必要な一式（episode）

既存の yt3 パイプラインに従う: Research/Evidence → episode.json → Script → Storyboard → Render → QA → publish gate。

- Research/Evidence: 原典の URL、取得日、根拠箇所（Chapter 6）、ライセンス表記を保存する。
- episode.json: 本書 §1〜§6 を章立てに落とす。
- Script / Storyboard: 4指標それぞれに具体例1つ以上を入れる。
- QA: 「測っているが判断できない」を避ける規則（§4）を満たすか確認する。
- publish gate: `task release:check` 相当の gate を通すまで公開しない。公開は個別承認が必要。

## 8. Definition of Done の対応

| DoD（issue） | 現状 |
|---|---|
| 4指標を具体例で説明 | 本書 §3 で定義（台本・動画は未制作） |
| 「測っているが判断できない」状態を避ける | 本書 §4 で規則化（repo への適用は未確認） |
| Evidence 保存 | 未実施。原典 URL の到達と本文取得のみ確認 |
| episode 一式と publish gate | 本書 §7 で手順を定義。制作・gate 実行は未実施 |

## 9. 残件

- yt3 の既存メトリクス（§3 の yt3 列）の存在確認。
- 原典のライセンス表記の確認と Evidence 保存。
- 各指標の閾値を config/ に置く設計（閾値の値は未決定）。
- episode.json、台本、Storyboard の作成（子 Issue の制作着手後）。
- 公開判断は個別承認が必要。本企画では公開していない。
