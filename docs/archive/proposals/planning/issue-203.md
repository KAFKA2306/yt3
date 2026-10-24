# Issue #203 計画: Series #03「SLOで『正常』を数字にする」

親: #200 / 原典: [Google SRE Book — Service Level Objectives](https://sre.google/sre-book/service-level-objectives/)

## 問い

どの水準なら「十分に正常」と判断するのか。

## 原典から確認した事実

確認元: 上記 SRE Book Chapter 4 の本文（WebFetch で取得し要約。引用は要約由来のため、動画台本に使う前に原文と照合する）。

- SLI: サービス品質を測る定量指標。
- SLO: SLI に対する目標値または範囲。「SLI ≤ 目標」の形で書く。
- SLA: 目標未達時の結果（罰則・補償など）を伴う利用者との契約。結果がなければ SLO と呼ぶ。
- SLI の例: availability（利用可能な時間の割合、正しい形式のリクエストの成功率）、latency（応答までの時間）、throughput（単位時間あたりの処理量）、correctness（正しい結果が返ったか）。
- 100% を目標にしない理由: 「SLO を 100% 満たすことは非現実的かつ望ましくない」。達成のために革新とデプロイが遅れ、過度に保守的な設計になるため。
- error budget: 許容される SLO 未達の割合。日次または週次で追跡し、新リリースの判断材料にする。

## 台本の骨子（Series #03）

1. 導入: 「正常」は感覚では決められない。数字にすると何が決まるか。
2. SLI: 利用者から見た良否を 1 つの比率として定義する（good events / valid events）。
3. SLO: 閾値を置く。閾値の意味を「何割まで失敗を許すか」として説明する。
4. 100% を狙わない理由と error budget の使い方。
5. yt3 への当てはめ（下記「リポジトリへの当てはめ」）。
6. まとめ: 閾値は事実ではなく合意。見直し条件を明記する。

## 具体化する SLO（提案）

対象は yt3 の byosan 準備パイプライン（`task byosan:prepare`）とする。

| 項目 | 内容 |
| --- | --- |
| SLI 種別 | correctness（release gate を PASS した run の割合） |
| SLI 定義 | 期間内に開始された `byosan:prepare` run のうち、`[product-release-gate] PASS` と `PUBLISH_READY_RUN` を出力した run の数 ÷ 開始された run の総数 |
| 除外 | 入力不備（`DATE` 未指定など）で開始前に失敗した run は分母に含めない |
| 集計期間 | 直近 28 日（ローリング） |
| SLO 目標（提案） | 90%。値は未測定の仮置きであり、確定には過去 run の実測が必要（UNVERIFIED） |
| error budget | 10% の未達を許容。月内の未達 run 数で残量を追跡する |
| 根拠の保存先 | `config/evidence/` 配下に集計 JSON を保存し、run id・集計期間・算出式を残す |

補足: latency SLI（run の所要時間）は、準備時間の実測データが揃うまで SLO にしない。availability SLI は外部 API 依存が多く、障害の切り分けを先に行う。

## リポジトリへの当てはめ

- 既存の CI 観測（#202 の Goals → Signals → Metrics）は「開発の健全性」の指標であり、SLO は「利用者に届くまでの品質」の指標として分けて扱う。
- publish gate は「SLO の一部」ではなく「個別 run の合否判定」。SLO はその合否を期間で集計した結果を扱う。
- gate の判定を緩めて SLO を満たすことは禁止する。目標未達は gate の変更理由にしない。
- 閾値は `config/` に置き、台本やドキュメントに数字をハードコードしない（AGENTS.md の方針に従う）。

## 完了条件への対応

| 完了条件 | 対応 |
| --- | --- |
| SLO を最低 1 つ具体化 | 上記「具体化する SLO（提案）」の 1 件 |
| 閾値の意味を説明 | 台本 4 で「90% = 10% まで未達を許容する」として説明 |
| Evidence 保存 | 集計結果を `config/evidence/` に保存する（未実施。実測後に作業） |
| episode 一式と publish gate | `config/series/` 相当の episode draft（JSON）と台本を作成し、`task release:check PROFILE=byosan -- <run-id>` で確認する（未実施） |

## 未完了・未確認の項目

- UNVERIFIED: SLO 目標 90% の妥当性。過去 28 日の run 実績が未取得のため、実測後に見直す。
- UNVERIFIED: SRE Book の引用文言。WebFetch の要約に基づくため、台本で原文を引用する前に原典で確認する。
- 未実施: Evidence の保存、episode draft の作成、release gate の実行。本ファイルは計画のみで、公開や publish は行っていない。
