# Issue #200 企画: 無料公開ソフトウェア工学本を8本シリーズで動画化する

対象: GitHub Issue #200（子Issue #201〜#208）
状態: 企画定義のみ。動画の制作・公開は行っていない。

## 1. 目的と範囲

- 目的: 全文無料公開の資料を材料に、「自分のrepoを数字で評価し、自動で改善する」までを独立した8回のシリーズとして投稿する。
- 範囲: 各回の問い、原典の要点、repo指標、Evidence保存先を定義する。原典の全文転載はしない。
- 最終到達点: #08 で「Goals → Signals → Metrics → threshold → CI/scheduled audit → 改善候補 → 修正 → 再計測」の学習経路が完結すること。

## 2. 一次ソースの到達確認

到達確認は 2026-10-10 に HTTP 200 を取得した範囲に限る。記載内容・章立ての正確さは未検証。

| 原典 | URL | 到達 |
|---|---|---|
| Software Engineering at Google | https://abseil.io/resources/swe-book/html/toc.html | 200 |
| Site Reliability Engineering | https://sre.google/sre-book/table-of-contents/ | 200 |
| The Site Reliability Workbook | https://sre.google/workbook/table-of-contents/ | 200 |
| The Architecture of Open Source Applications | https://aosabook.org/en/ | 200 |
| ソフトウェアアーキテクトが知るべき97のこと（日本語訳） | https://yoshi389111.github.io/kinokobooks/soft_ja/index.html | 200 |

- UNVERIFIED: 各資料の利用許諾（再利用・引用の範囲）。issue は「合法的に全文無料公開」と記載するが、ライセンス本文は未確認。動画で引用する前に各サイトのライセンス表記を確認し、Evidence に記録する。
- UNVERIFIED: #02 の原典「Measuring Engineering Productivity」。issue の一次ソース一覧に URL がないため、URL と到達確認は未実施。

## 3. 回ごとの定義

各回は独立して成立させる。固定フォーマットは issue の6項目（今回の問い / 原典の考え方 / 具体例 / よくある誤用 / repoへの当てはめ / 次回への接続）。

| 回 | 子Issue | 今回の問い | 原典 | 出口（repoで測るもの） |
|---|---|---|---|---|
| #01 | #201 | なぜソフトウェア開発を数字で測るのか | Software Engineering at Google | 測定対象を「速さ」「品質」「安定性」「保守性」に分解する |
| #02 | #202 | 目的から、どの数字を選ぶか | Software Engineering at Google / Measuring Engineering Productivity（UNVERIFIED） | Goals → Signals → Metrics の3段で repo KPI を1つ以上定義する |
| #03 | #203 | 何%なら正常か | Google SRE | availability / latency / correctness を SLO として数値化する |
| #04 | #204 | 監視で何を見るか | Google SRE（Monitoring Distributed Systems） | latency / traffic / errors / saturation を repo・サービス向けに翻訳する |
| #05 | #205 | 指標を改善ループにつなぐには | The Site Reliability Workbook | 計測 → 閾値 → alert → action → 検証 の流れを定義する |
| #06 | #206 | 良い設計は何を測れる構造か | The Architecture of Open Source Applications | 実例（Git / nginx / Hadoop / LLVM 等）から「測るべき構造」を逆算する |
| #07 | #207 | アーキテクトは何を数字で守るか | ソフトウェアアーキテクトが知るべき97のこと | 定量化、主要指標の耐久性、技術的負債を設計判断と結ぶ |
| #08 | #208 | repoを数字で評価して自動改善するには | #01〜#07 の総集編 | 8ステップ（Goals〜再計測）を CI / scheduled audit で回す |

各回の必須項目:
- 自分のrepoで測る指標を最低1つ明記する。
- 一次ソースの URL と根拠箇所（章・節）を Evidence に保存する。
- 引用は必要最小限にし、説明は自分の言葉で再構成する。
- title / description に「シリーズ #NN」を統一して入れる。
- 公開後、description に次回への導線を入れる。

## 4. 制作順

issue の優先度: **#202 → #201 → #203 → #204 → #205 → #206 → #207 → #208**

- #02 を最上位とする理由: 実装（repo KPI 定義）に直結するため。
- #01 は導入回として前後どちらでも制作できる。
- 既存の下書き `docs/series/issue-202_episode_draft.json` と `docs/series/issue-202_script_draft.md` があるため、#202 はこれを起点にする。内容の妥当性は今回未確認。

## 5. yt3 パイプラインへの載せ方

各回は既存の流れに従う: Research/Evidence → episode.json → Script → Storyboard → Render → QA → publish gate。

- 公開（publish）は個別に承認を取る。本企画書の作成は公開を含まない。
- Evidence には「URL / 取得日 / 根拠箇所 / ライセンス表記」を保存する。ライセンス欄は現時点で未確定（セクション2参照）。

## 6. Definition of Done の対応

| DoD（issue） | 現状 |
|---|---|
| 各回が独立した episode として定義されている | 本書 §3 で定義（未制作） |
| 一次ソースURLと根拠箇所を Evidence へ保存 | 未実施。URL到達のみ確認 |
| 引用は必要最小限、自分の言葉で再構成 | 制作時の要件（未実施） |
| 各回に具体的な repo 指標を最低1つ | 本書 §3 で定義 |
| シリーズ番号を title / description に統一 | 制作時の要件（未実施） |
| 公開後に次回への導線を description へ追加 | 公開後の要件（未実施） |
| 全8回で1本の学習経路になる | 企画上の構成は成立。制作・検証は未実施 |

## 7. 残件

- Evidence 保存（各原典の根拠箇所、ライセンス表記）。
- #02 の原典 URL 特定と到達確認。
- 日本語訳書の利用条件の確認。
- 各子Issue（#201〜#208）の制作着手。
- 公開判断は個別承認が必要。
