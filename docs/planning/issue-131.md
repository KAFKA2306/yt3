# Issue #131 企画計画: AIインフラ「6つのボトルネック」

対象: 動画企画「NVIDIAだけ見てると半分しか見えない — AIインフラ6つのボトルネックを可視化する」
出典: GitHub Issue #131（`gh issue view 131`で取得）
状態の表記: `VERIFIED`（一次情報で確認済み）/ `UNVERIFIED`（未確認。数値・事実として使用不可）

---

## 1. 目的と中心命題

- 中心命題: AIインフラはGPUだけではない。GPUを動かすには HBM、先端パッケージ、ネットワーク、光通信、電力、冷却を同時に増強する必要がある。
- 投資判断の断定はしない。各社がAI設備投資のどの部分を担うかを一次情報で可視化する。
- 株価ランキングは主題にしない。

## 2. 視聴者に持ち帰ってほしいこと（受け入れ基準の一部）

1. AIインフラを「GPU銘柄」という1カテゴリで見ない
2. CapExがどのレイヤーへ波及するかを理解する
3. レイヤーごとにKPIが違うことを理解する
4. 株価ではなく、設備投資・受注・供給制約を先に見る

## 3. 動画の完成定義（Done）

動画だけで次の問いに答えられること。

> AIデータセンターへの100円の追加投資は、GPU以外のどこへ流れるのか。そして次の設備投資サイクルを見るために何の数字を追えばよいのか。

「注目銘柄一覧」で終わった場合は未完了とする。

## 4. レイヤー定義（7層）

Issue本文の6つのセクションに、Canonical Tableの `layer` enum（7値）を対応させる。

| # | layer enum | 動画上の名称 | 主な対象企業（Issue記載） | primary KPI（候補） |
|---|---|---|---|---|
| 1 | `compute` | Compute / Accelerator | NVIDIA, AMD, Broadcom, Marvell | Data Center revenue, accelerator shipments, backlog |
| 2 | `memory` | HBM / Memory | SK hynix, Micron, Samsung Electronics | HBM bit growth, HBM revenue mix |
| 3 | `foundry_packaging` | 先端パッケージ / 製造 | TSMC | CoWoS / advanced packaging capacity, capex |
| 4 | `semicap_equipment` | 半導体製造装置 | ASML, Applied Materials, Lam Research, KLA, 東京エレクトロン, Advantest, DISCO | WFE outlook, order / backlog |
| 5 | `network_optical` | ネットワーク / 光 | Arista, Broadcom, Marvell, Credo, Astera Labs, Coherent, Lumentum, フジクラ, 古河電工 | 800G / 1.6T 需要, AI networking revenue |
| 6 | `power` | 電力 | Eaton, Schneider Electric, GE Vernova, Siemens Energy, Quanta Services, Prysmian, 日立製作所, 三菱重工, ダイヘン, SWCC | data-center order growth, backlog, lead time |
| 7 | `cooling_datacenter` | 冷却 / データセンター | Vertiv, Schneider Electric, Eaton, Trane Technologies, Modine, ダイキン, Equinix, Digital Realty | liquid cooling sales, MW capacity, occupancy |

注意点:
- Issue本文の見出しは6節（Compute, HBM/Memory/Packaging, Semicap, Network/Optical, Power, Cooling）だが、enumは7値。`memory` と `foundry_packaging` を分けた。Issue本文の「HBM / Memory / Advanced Packaging」節に対応する。
- 同一企業が複数層に出る（Broadcom, Marvell, Eaton, Schneider Electric）。Canonical Tableでは **1社1行ではなく、企業×layerの行** で持つ。`sub_layer` で役割を区別する。
- 日本企業（フジクラ、古河電工、日立製作所、三菱重工、ダイヘン、SWCC、ダイキン、東京エレクトロン、Advantest、DISCO）はticker・決算区分（日本の会計年度）を統一して記録する。

## 5. Canonical Table 仕様

Issue記載の15列をそのまま採用する。

```
company, ticker, layer, sub_layer, ai_infra_role, primary_kpi,
latest_kpi_value, latest_kpi_period, capex, backlog, revenue_growth,
constraint_signal, primary_source_url, source_date, confidence
```

運用ルール:
- `latest_kpi_value` には必ず単位を付ける（例: `USD bn`, `JPY bn`, `%`, `MW`）。
- `primary_source_url` は IR・決算資料・10-K/10-Q/20-F・EDINET・公式投資家向け資料のいずれか。
- `source_date`（資料の日付）と取得日（retrieval date）を分けて記録する。取得日は別列が必要なため、列追加を提案する（下記 §11）。
- `confidence` は `high` / `medium` / `low` の3段階。`low` の行は動画本文で数値を使わない。
- 数値は取得時点の `UNVERIFIED` のまま出さない。`VERIFIED` になるまで値欄は空にする。

## 6. 一次情報ポリシー

- 原則: 企業IR、決算発表資料、決算説明資料、10-K/10-Q/20-F、EDINET、公式投資家説明会、公式ガイダンス。
- 補助: Reuters、業界団体、市場調査（一次情報の引用元を必ず辿る）。
- 禁止: 出典不明のSNS数値、二次記事のみを根拠にした市場規模、「AI関連だから伸びる」という循環論法。
- すべての数値に `period` / `source` / `retrieval date` を付ける。

## 7. 研究課題（RQ）と答えの置き場

| RQ | 問い | 必要な証拠 | 動画での使い先 |
|---|---|---|---|
| RQ1 | Hyperscaler CapEX増加は、どのレイヤーの売上・受注へ最も早く伝播するか | 大手クラウド各社のCapEX資料、各層の受注・売上 | CapEx flow chart |
| RQ2 | 2026年時点で供給制約が残るレイヤーはどこか | 各社のbacklog、lead time、capacity発言 | Bottleneck matrix |
| RQ3 | 供給制約が解消方向か悪化方向かを何のKPIで判断できるか | 時系列KPI（backlog推移、capacity計画） | KPI comparison |
| RQ4 | 成長が需要そのものではなく能力増強の先食いになっていないか | capex対売上、backlog対売上の推移 | 結論部 |
| RQ5 | GPU台数増加に対しnetwork/power/coolingがどれだけ連動するか | 各層の受注・MW・出荷の比較 | Bottleneck matrix |

RQ2とRQ5は一次情報だけでは答えが出ない可能性がある。その場合は「一次情報で確認できた範囲」と「推論」を画面上で分けて書く。

## 8. 動画構成（Outline 最低6 section）

各sectionは `Fact → Structural Meaning → Human Relevance → Future Shift` の順で書く。

| # | section | 主な内容 | 使用チャート |
|---|---|---|---|
| 0 | Hook | NVIDIAの連想 → GPUだけでは動かない → 反復 → 6層へのPivot | なし |
| 1 | Compute / Accelerator | GPU以外（custom ASIC, switch silicon, interconnect）を含める | 業界地図 |
| 2 | HBM / Memory / Packaging | 「次に詰まるのはHBMか先端パッケージか」 | Bottleneck matrix |
| 3 | Semiconductor Equipment | AI需要を製造能力増強に変換する層 | 業界地図 |
| 4 | Network / Optical | 「GPU同士をどう繋ぐか」 | Bottleneck matrix |
| 5 | Power | 「電力を引けなければ計算できない」 | Bottleneck matrix |
| 6 | Cooling / Data Center | 「高密度ラックの発熱をどう処理するか」 | Bottleneck matrix |
| 7 | 結論 | CapEx flow と追うべきKPI | CapEx flow chart, KPI comparison |

Issue #128 の Comedy Beat は最大1〜2箇所。候補は次の2つ（事実の誇張は禁止）。
- 「HBMも必要、光も必要、電力も必要、冷却も必要」
- 「AIデータセンター、GPUを置けば完成すると思ったら建築・電気設備プロジェクトだった」

## 9. 主要チャートの仕様

1. AIインフラ業界地図: Compute → Memory/Packaging → Network → Power → Cooling の順に企業を配置する。
2. CapEx flow chart: Hyperscaler CapEX → 半導体キャパシティ → ネットワーク → 電力/冷却 の順に資金波及を示す。
3. Bottleneck matrix: 列は layer / demand signal / capacity constraint / backlog / lead time / representative companies。
4. KPI comparison: 売上成長率に加えて backlog / capacity / capex を並べる。

チャートの描画は既存の作業フロー（dataviz スキル）に従う。図解は drawio など既存ツールを使う。

## 10. yt3 への落とし込み

既存の canonical flow を使う。

```
Research → evidence ledger → Outline → Segment → Metadata → Render → QA
```

- Research: 本計画 §5 の Canonical Table を埋める（evidence ledger の行単位）。
- Outline: §8 の6 section 以上。
- Segment / Metadata / Render / QA: 完成条件（§12）の順に検証する。

## 11. 未決事項・Issue本文の不整合

| # | 内容 | 提案 |
|---|---|---|
| 1 | Canonical Table に「取得日」列がない | 列を追加する（`retrieval_date`）。Issue本文の「retrieval date を付与」要件を満たすため |
| 2 | 企業の重複（Broadcom, Marvell, Eaton, Schneider Electric） | 企業×layerの行として扱う（§4） |
| 3 | 見出しは6節、enumは7値 | 本計画の7層で統一する |
| 4 | 「Comedy Beat schema」（Issue #128）の仕様が本Issueに無い | Issue #128 の確認が必要（UNVERIFIED） |
| 5 | 日本企業の会計年度・ticker表記の基準が無い | 取得時に決算期と取引所コードを併記する |
| 6 | 「AI関連売上」「backlog」の定義が企業ごとに異なる | 定義を `primary_kpi` 列の備考に残す |

## 12. 完成条件（Issue記載）と検証方法

| 完成条件 | 検証方法 | 状態 |
|---|---|---|
| AIインフラ企業を7 layerへ正規化 | Canonical Table の `layer` が enum 7値のみであることを検査 | 未着手 |
| 各layer 3社以上を一次情報で確認 | layerごとの `VERIFIED` 行数を集計 | 未着手 |
| 各企業に primary KPI を1つ以上付与 | `primary_kpi` 空欄チェック | 未着手 |
| 数値に period / source / retrieval date を付与 | 数値行の必須列チェック | 未着手 |
| bottleneck を定量または一次情報の明示表現で根拠化 | Bottleneck matrix の各セルに出典URLがあること | 未着手 |
| AIインフラ業界地図を生成 | 生成物の存在確認 | 未着手 |
| bottleneck matrix を生成 | 同上 | 未着手 |
| outline を生成 | §8 の6 section以上 | 未着手 |
| script を生成 | 各sectionが Fact → Structural Meaning → Human Relevance → Future Shift を満たすか | 未着手 |
| Issue #128 Comedy Beat 互換 | #128 のschemaとの照合（§11-4 解消後） | 未着手 |
| script linter PASS | yt3 の linter 実行結果 | 未着手 |
| factual QA PASS | 全数値の出典・期間・取得日の照合 | 未着手 |
| render smoke PASS | render コマンドの終了コードと出力確認 | 未着手 |
| 実動画E2E PASS | 実際に動画を生成し再生確認 | 未着手 |

本計画の時点では、どの完成条件も達成していない。上の表は検証の計画であり、達成の証拠ではない。

## 13. 本計画の範囲外

- 投資助言、銘柄推奨、目標株価。
- 株価ランキング。
- 一次情報が取れない数値の推定値。
- 公開・アップロード（別途承認が必要）。
