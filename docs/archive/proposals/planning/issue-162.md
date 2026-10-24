# Issue #162 企画整理: QorvoのCapEx訂正から見る「半導体投資DBの罠」

対象: GitHub Issue #162（【動画企画】QorvoのCapExを77M→129Mへ訂正したら見えた「半導体投資DBの罠」）
作成範囲: 企画・検証計画のみ。DBへの登録、動画生成、公開は行っていない。

## 1. 結論

- 中核の主張は「設備投資（CapEx）の一次資料照合で、下流の能力・売上・EPS・PERの推定が連鎖的に崩れる」こと。
- Qorvo FY2026 のCapEx は、Issue記載の $129.070m を二次情報（EDGAR集約サイト・第三者CapExトラッカー）で概ね確認できた。ただし10-K本文のキャッシュフロー計算書の該当行は未確認。
- 旧DBの $77.359m の由来と、差異 $51.711m（約+66.8%）の原因は未確定。原因の断定はしない。
- 動画は「数字の訂正プロセス」を主題にし、未確認値を確定値として話さない。

## 2. 数値照合表（Qorvo FY2026, 期末 2026-03-28）

| 項目 | Issue記載値 | 一次資料での確認状況 | 判定 |
| --- | --- | --- | --- |
| CapEx | $129.070m | 二次情報で約$129.1m（$129m）。10-Kの行は未読 | 概ね一致 / 要10-K照合 |
| 前期CapEx (FY2025) | 記載なし | 二次情報で約$138m（$137.6m） | 参考 |
| 旧DB CapEx | $77.359m | 由来未特定 | UNVERIFIED |
| 差分 | +$51.711m / +66.8% | 上記2値から計算: 51.711 / 77.359 = 66.85% | 計算一致 |
| Revenue | $3,678.517m | 未照合 | UNVERIFIED |
| Operating income | $411.424m | 未照合 | UNVERIFIED |
| Net income | $338.989m | 未照合 | UNVERIFIED |
| Operating cash flow | $808.631m | 未照合 | UNVERIFIED |
| FCF | $679.561m | 計算一致: 808.631 - 129.070 = 679.561 | 計算一致 / 入力値は未照合 |
| Purchase obligations | 約$524.3m | 未照合 | UNVERIFIED |

一次資料URL（確認に使用する正本）:
- Qorvo 10-K FY2026: https://www.sec.gov/Archives/edgar/data/0001604778/000162828026032873/rfmd-20260328.htm
- 二次確認（CapEx）: https://tickerleague.com/companies/QRVO/financials/capex （一次資料ではない。照合の補助のみ）

## 3. 差異原因の候補（確定前）

Issueの7候補をそのまま検証項目にする。どれが原因かは10-K本文と旧DBの取得元を見て決める。

1. fiscal year / calendar year の混同
2. property additions と cash CapEx の混同
3. quarterly / annual の混同
4. 単位の違い
5. continuing operations 等の範囲差
6. 二次データベンダーのmapping
7. period_end の誤認

検証手順:
- 旧DBの $77.359m の source_url と取得日時を確認する（DBの履歴から）。
- 10-K の investing activities 行（purchases of property and equipment 等）の定義文を確認する。
- 上記7候補のうち、$77.359m を再現できるものを探す。再現できなければ「原因不明」と記録する。

## 4. 動画構成（Issue準拠・各節の検証条件）

1. 77Mが129Mになった（Before/After）: 差分そのものより、上流誤差が下流へ伝播する点を示す。
2. 数字がズレる理由: 3節の候補を並べ、確定したものだけ断定する。
3. CapExだけでは足りない: 投資内容・稼働時期・稼働率・製品mix・顧客需要・purchase commitments・restructuring を確認項目として提示する。
4. QorvoをSupply Chainへ接続: Products_SupplyChain / Demand_Commitments / CapEx_Events / Capacity_Metrics を使う。RF / connectivity / defense & aerospace 等は事業実態どおりに分類し、AI半導体テーマへ寄せない。
5. 他社へ展開: ALAB / MTSI / COHR / ARM 等。売上成長率ランキングではなく、CapEx → Capacity → Revenue → EPS → valuation の接続率を見る。
6. 投資家が見るべきDB: actual / company guidance / external consensus / inferred / unavailable を分離する。0埋め禁止。source_url / publication_date / as_of_date / retrieved_at / status を保持する。

## 5. 必要Visual（6点）

1. Qorvo CapEx Before / After（棒グラフ）
2. CapEx → Capacity → Revenue → EPS → Forward PER の因果図（drawio）
3. 「数字がズレる7つの理由」図
4. Qorvo FY2026 cash-flow bridge（Operating cash flow 808.631 → CapEx 129.070 → FCF 679.561）
5. purchase obligations $524.3m との比較（照合後のみ）
6. 主要半導体企業の一次資料確認率 / 時系列接続率（DBから算出）

Visual 1・4 は現時点で数値入力が揃う。5 は purchase obligations の照合が前提。

## 6. 作業計画（Research Tasks の担当分け案）

| # | 作業 | 依存 | 状態 |
| --- | --- | --- | --- |
| 1 | 旧CapEx $77.359m の由来特定 | 旧DB履歴 | 未着手 |
| 2 | 10-K から CapEx の定義と構成を確定 | 10-K本文 | 未着手（一部のみ二次確認済） |
| 3 | purchase obligations $524.3m を Demand_Commitments へ登録 | 2 | 未着手 |
| 4 | 主要 product / end market を Products_SupplyChain へ接続 | 10-K事業説明 | 未着手 |
| 5 | CapEx_Events / Capacity_Metrics に一次資料で確認可能なイベントを登録 | 10-K・決算資料 | 未着手 |
| 6 | QRVO の Revenue / EPS / Forward PER まで時系列接続 | 2, 5 | 未着手 |
| 7 | ALAB / MTSI / COHR / ARM 等で同じ監査 | 1–6 のテンプレート化 | 未着手 |
| 8 | DB全体の primary-source coverage を算出 | 7 | 未着手 |
| 9 | 動画用チャートを DB から再生成可能にする | 8 | 未着手 |

## 7. 受け入れ基準の現状

| 基準 | 現状 |
| --- | --- |
| Qorvo FY2026 数値を 10-K と完全照合 | 未達。CapExのみ二次情報で概ね一致。10-K本文は未読 |
| $77.359m → $129.070m の差異原因を説明できる | 未達。原因候補のみ |
| actual / guidance / consensus / inference を混在させない | 設計のみ。DB側は未実装 |
| 最低5社で CapEx → Capacity → Revenue → EPS → Forward PER を可視化 | 未達（Qorvo 1社も接続未完） |
| 全数値に period と source を付与 | 本文の表で付与済み。DB側は未実装 |
| Semiconductor CapEx Decision DB と動画入力値が一致 | 未達。DB照合未実施 |
| 一次資料未確認値を確定値としてナレーションしない | 方針として明記（本書の UNVERIFIED 表示を動画台本に引き継ぐ） |
| yt3 canonical pipeline で再生成可能 | 未達 |

## 8. 残件と未確認事項

- UNVERIFIED: 旧DB CapEx $77.359m の由来。
- UNVERIFIED: 10-K 本文のキャッシュフロー計算書の CapEx 行（$129.070m の一次資料での確定）。
- UNVERIFIED: Revenue / Operating income / Net income / Operating cash flow / purchase obligations の各値。
- UNVERIFIED: 他社（ALAB / MTSI / COHR / ARM / Rambus / Teradyne / Entegris）の数値は未着手。
- 本書は企画・計画のみ。DB更新、チャート生成、台本作成、公開はいずれも未実施。

## 9. 参照

- Issue: 本リポジトリの GitHub Issue #162（`gh issue view 162` で取得）
- Qorvo 10-K FY2026: https://www.sec.gov/Archives/edgar/data/0001604778/000162828026032873/rfmd-20260328.htm
- CapEx 二次確認: https://tickerleague.com/companies/QRVO/financials/capex
