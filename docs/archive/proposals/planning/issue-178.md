# Issue #178 企画・検証計画: 半導体DBの継続監査を動画化する

対象: GitHub Issue #178「【動画企画】半導体DBを毎日監査すると何が見える？ 一次資料でCapEx→利益→バリュエーションを自動接続する」
正本: Google Sheets「Semiconductor CapEx Decision DB」(Issue本文記載のURL)

## 0. 事実確認の状態

- 本ドキュメントはIssue本文のみに基づく。正本DBの中身、テーブル列、各実例の数値は**未確認 (UNVERIFIED)**。
- 正本へのアクセス、EDINET/SEC/IRからの再取得は本作業では実施していない。
- 動画中の数値は、正本から生成した値とソース付きで照合するまで採用しない。

## 1. 動画の主張 (Done 基準)

視聴者が次を理解すること:

> 投資調査のボトルネックは1回の分析能力だけではなく、一次資料を同じschemaで反復検証し、時系列で接続し続けるthroughputにもある

**非目標**: 「AIで決算分析しました」型の単発要約。AIを要約器として見せない。

## 2. 正本と監査対象

### 2.1 対象テーブル (11)

| テーブル | 監査の主眼 |
|---|---|
| Issuer_Master | issuer_id の一意性、他テーブルからのFK |
| Financials | 最新四半期の欠落、fiscal/calendar 混同、unit/currency |
| CapEx_Events | 列ずれ、source欠落、期間 |
| Demand_Commitments | 顧客/契約の出典、actual と commitment の分離 |
| Capacity_Metrics | capacity未開示の扱い、単位 |
| Estimates_Valuation | guidance / consensus の分離、as_of_date |
| Products_SupplyChain | 製品と工程の接続先 |
| Fund_Products | 商品マスタ |
| Fund_Holdings | as_of_date、ETF保有の鮮度 |
| Market_Prices | 価格の鮮度 (stale) |
| Sources | 一次資料の正本台帳 (publication_date, retrieved_at) |

原則: 動画側に別正本を作らない。集計・チャート入力はすべて正本から生成する。

### 2.2 監査ルール (テスト化対象)

1. issuer_id FK 不一致 (他テーブル → Issuer_Master)
2. 重複行
3. 列ずれ
4. unit / currency 混同
5. fiscal / calendar period 混同
6. actual と guidance の混在
7. guidance と consensus の混在
8. source_url 欠落
9. publication_date / as_of_date / retrieved_at 欠落
10. 時系列断絶 (期間の欠番)
11. stale-value (閾値超過の古い値)
12. status の欠落

### 2.3 空欄の扱い

- 空欄を `0` で埋めない。
- 値の状態は明示的な status で保持する: `not_disclosed` / `unavailable` / `pending_primary_source` / `stale` (Issue本文の4値を正とし、追加が必要なら本書で定義してから DB に入れる)。
- status の無い空欄は監査で FAIL とする。

## 3. 4層分離

| 層 | 意味 | 典型source | 混ぜない相手 |
|---|---|---|---|
| actual | 開示済みの実績 | EDINET / SEC EDGAR XBRL / company IR | guidance, consensus |
| guidance | 会社の業績・投資計画 | 決算説明資料、IR | consensus, inferred |
| consensus | 外部の市場予想 | market-data layer | actual, guidance |
| inferred | 推定値 | 計算式・推定根拠を併記 | actual |

Forward EPS / Forward PER は market-data layer の別 authority に置く。一次資料と混ぜない。

### 3.1 source authority の優先順位

- 日本: EDINET → company IR
- 米国: SEC EDGAR / XBRL → company IR
- 韓国・台湾・欧州: company IR / exchange / regulatory filing
- market price, consensus, ETF holdings 等: 別 market-data layer

## 4. 因果鎖と接続の定義

```text
Issuer → Financial actuals → CapEx event → Fab/project → Capacity
  → Product/customer demand → Revenue/EPS → Forward EPS → Forward PER/PEG → Market price
```

各矢印は次を持つ:

- period (対象期間)
- source (source_id)
- status (`connected` / `gap` 等。gap の理由を status に持たせる)

**接続率 (connection coverage)**: 矢印のうち status が connected の割合。gap は隠さず数える。

**受け入れ条件の解釈**: 最低5社で「接続済み」または「どの矢印で証拠が切れたかの明示」。

## 5. 動画用の可視化 (8 visual)

| # | Visual | データ源 |
|---|---|---|
| 1 | DB 11テーブル関係図 | スキーマ定義 (drawio で作成) |
| 2 | Gap detector 画面 / coverage heatmap | 監査結果 |
| 3 | CapEx→Capacity→Revenue→EPS→Forward PER 因果図 | 接続 status |
| 4 | actual / guidance / consensus / inferred 4層図 | 2.2 と 3 |
| 5 | 修正 Before / After 実例 | 修正前後の DB snapshot |
| 6 | issuer別 時系列 connection coverage | 接続率 |
| 7 | source authority map | Sources |
| 8 | 1 run の throughput chart | run ログ |

チャート実装時は dataviz スキルの配色・アクセシビリティ規則に従う。

## 6. 実例 (動画で見せる修正)

各例は「修正前の状態 / 検出ルール / 一次資料 / 修正後」の4点を記録してから動画に使う。

| 実例 | 検出ルール候補 | 状態 |
|---|---|---|
| SCREEN: 最新四半期 Financials 欠落 | 時系列断絶 | UNVERIFIED |
| KOKUSAI ELECTRIC: Financials + OCF + PP&E CapEx 接続 | 接続欠落 | UNVERIFIED |
| ローツェ / TOWA: Q1 FY2027 時系列断絶 | 時系列断絶 | UNVERIFIED |
| 東京精密: Sources に一次資料あり、Financials 行欠落 | source 整合 | UNVERIFIED |
| ルネサス: actual と company guidance の分離 | 4層分離 | UNVERIFIED |
| キオクシア: LTA / AI SSD / Flash 需要と CapEx の接続 | 接続欠落 | UNVERIFIED |
| Sony × TSMC: CapEx_Events の列ずれ・source 欠落 | 列ずれ / source 欠落 | UNVERIFIED |
| レーザーテック: EUV inspection product を Products_SupplyChain へ接続 | 接続欠落 | UNVERIFIED |

## 7. 動画構成 (7 セクション)

1. **Hook**: 決算、工場計画、HBM 能力、顧客、コンセンサス、株価が別々の場所にある。全部を同じ正本に入れて欠けを機械的に探す。
2. **まず DB を疑う**: 新情報の探索前に既存 DB を監査。見つかった欠落・列ずれ・source 不足を紹介 (実例 6 から)。
3. **一次資料へ戻る**: EDINET / SEC / company IR から再取得し、source metadata 付きで canonical 化。
4. **時間軸へ接続**: CapEx 単体・EPS 単体でなく因果鎖として見せる (visual 3)。
5. **予想レイヤーを分離**: guidance と consensus を混ぜない (visual 4)。
6. **不足自体がデータ**: capacity 未開示、顧客非開示、forward estimate 不足を coverage として表示 (visual 2, 6)。
7. **人間 1 人で調査量を増やす**: 全 Issuer を反復監査し、例外だけ人間へ上げる (visual 8)。

## 8. 反復ループと KPI

ループ:

```text
全Issuer監査 → gap detection → source retrieval → normalization
  → canonical write → QA → 次のgapへ
```

測定 KPI と定義 (分母を明記する):

| KPI | 定義 |
|---|---|
| issuers audited / run | 1 run で監査した Issuer 数 |
| facts retrieved / run | 1 run で一次資料から取得・登録した fact 数 |
| primary-source coverage | 一次資料 source を持つ fact / 全 fact |
| time-series connection rate | connected 矢印 / 全矢印 |
| source-missing count | source_url 等が欠落した行数 |
| stale-value count | 閾値超過の行数 |
| human intervention / 100 records | 人手介入回数 / 100 records |
| cost / verified record | 総コスト / QA を PASS した record 数 |

動画中の数値は、run ログと DB snapshot から生成されたものだけを使う。

## 9. 実装タスクと受け入れ条件の対応

| Issue タスク | 受け入れ条件 | 成果物 |
|---|---|---|
| 11テーブル coverage audit 自動化 | 11テーブルを自動監査できる | 監査ジョブ |
| issuer_id FK check | issuer_id 不整合を検出 | FK テスト |
| duplicate / unit / currency / period tests | 重複・単位・期間を検出 | テスト群 |
| stale-value detector | 未開示を 0 扱いしない / stale 検出 | 検出器 |
| source / date / status completeness test | source 欠落を検出 | 完全性テスト |
| actual / guidance / consensus / inferred 分離 test | 4層分離 | 分離テスト |
| 接続 coverage 算出 | 最低5社で接続またはgap明示 | 接続レポート |
| 日本半導体 Issuer の forward EPS / revenue 不足収集 | 全数値に period と source | 収集ログ |
| Market_Prices 鮮度監査 | stale 検出 | 監査結果 |
| ETF holdings / AUM の as_of_date 監査 | as_of_date 欠落検出 | 監査結果 |
| macro 接続 (USDJPY / rates / copper / gold / electricity) | market layer に分離 | market layer |
| dbt で canonical tests / lineage / marts | dbt tests PASS | dbt プロジェクト |
| yt3 chart input を正本から自動生成 | 動画中の全数値が正本と一致 | 生成スクリプト |
| 動画生成時点の DB snapshot / source ledger 保存 | yt3 canonical pipeline から再生成可能 | snapshot |

## 10. 未決事項と残件

- 正本 DB の現状 (行数、欠落件数、各実例の修正前状態): UNVERIFIED。監査ジョブ実行後に確定する。
- dbt を採用する場合の配置場所と実行基盤: 未決。既存の `task` 体系に組み込むか別プロジェクトにするかを決める。
- 4値 status (`not_disclosed` 等) の語彙は Issue 本文の定義を採用。追加・改名は本書を更新してから DB に反映する。
- market-data layer の提供元と利用条件: UNVERIFIED。無料枠・ライセンスを確認するまで採用しない。
- 日本語タイトル候補 (Issue 記載の3案) の選定: 未実施。動画公開前に決める。
- 公開・投稿は本計画の範囲外。公開には別途明示的な承認が必要。

## 11. 次のアクション

1. 正本 DB の 11 テーブルについて監査を実行し、件数と欠落を記録する (実行は read のみ)。
2. 実例 8 件それぞれについて、修正前の状態と一次資料を確認し、本書 6 節の表を更新する。
3. 2.2 の監査ルールを tests として実装し、結果を 8 節 KPI の算出に使う。
4. 5 社以上で 3 節と 4 節の接続を実施し、gap を明示する。
