# 半導体は「何個作れるか」で見る — 企画・データ計画 (Issue #164)

- 対象: GitHub Issue #164（動画企画）
- 正本: Google Sheets「Semiconductor CapEx Decision DB」（動画側に別の正本を作らない）
- 本書の位置づけ: 企画・受け入れ基準・データ計画の整理。数値は本書では一切確定しない（未検証事実は `UNVERIFIED` と記す）

## 1. 目的と Core Question

核心の問い:

> 半導体企業が巨額CapExを発表したとき、その金額はいつ、どれだけの生産能力になり、売上・EPSへ変わり、現在のForward PERはその成長をどこまで織り込んでいるのか。

変換経路（因果チェーン）:

```text
CapEx → Fab / equipment / advanced packaging → Capacity → Shipment / utilization / mix
→ Revenue → Operating income / FCF / EPS → Forward EPS / Forward PER / PEG
```

## 2. スコープ

| 区分 | 企業 |
|---|---|
| Memory / HBM | SK hynix, Micron, Samsung Electronics |
| Foundry / Packaging | TSMC |
| Accelerator / ASIC | NVIDIA, AMD, Broadcom, Marvell |
| Semiconductor Equipment | ASML, Applied Materials, Lam Research, KLA, Tokyo Electron, Advantest, DISCO |

最初に埋める接続は4本: SK hynix / Samsung / Micron（HBM）と TSMC（wafer・CoWoS）。Done 条件（最低4社で一本化）はこの4本で満たす。

## 3. 正本 DB の利用テーブル

| テーブル | 用途 |
|---|---|
| Issuer_Master | 企業の正規化（issuer_id の唯一の参照先） |
| Financials | revenue / operating income / EPS / FCF の actual |
| CapEx_Events | CapEx 発表・金額・期間 |
| Demand_Commitments | 需要側の契約・コミットメント |
| Capacity_Metrics | capacity 数量（単位保持） |
| Estimates_Valuation | forward EPS / revenue estimate / PER / PEG |
| Products_SupplyChain | HBM 世代・CoWoS・顧客関係 |
| Fund_Products / Fund_Holdings | 投資商品と保有（本動画では推奨に使わない） |
| Market_Prices | price / YTD / 1M / 1Y / drawdown |
| Sources | 全数値の出典台帳 |

## 4. データ品質ルール（動画生成の前提）

1. 値の種別を分離する: `actual` / `company_guidance` / `external_consensus` / `inferred`。混在させない。
2. 未開示値を 0 で埋めない。一次資料で数量が開示されない capacity は `not_disclosed` と記録する。
3. 単位を保持する（wafer/month、wafer/year、bits、GB、packages/month 等）。無理な換算をしない。
4. 各行に `source_url`、`publication_date` または `as_of_date`、`retrieved_at`、`status` を持たせる。
5. `issuer_id` は Issuer_Master へ正規化する。不一致は修正対象。
6. 重複・期間・通貨・単位・source 欠落を、動画生成前に再監査する。

## 5. 必要 Visual（8点）と必要データ

| # | Visual | 必要データ | 備考 |
|---|---|---|---|
| 1 | CapEx→Capacity→Revenue→EPS→Forward PER 因果図 | 概念図（数値なし） | drawio で作成 |
| 2 | SK hynix / Samsung / Micron HBM capacity timeline | CapEx_Events, Capacity_Metrics, Products_SupplyChain | 単位差を注記 |
| 3 | TSMC wafer / CoWoS capacity timeline | Capacity_Metrics, CapEx_Events | 開示粒度が不明なら `not_disclosed` |
| 4 | CapEx増加率 vs capacity増加率 | CapEx_Events, Capacity_Metrics | 増加率は同一期間で計算 |
| 5 | capacity増加 vs revenue / EPS 成長 | Capacity_Metrics, Financials | actual のみ |
| 6 | Forward EPS growth vs Forward PER | Estimates_Valuation, Market_Prices | consensus と actual を混ぜない |
| 7 | AI accelerator → HBM → CoWoS 供給網図 | Demand_Commitments, Products_SupplyChain | 関係図 |
| 8 | 開示 / 未開示 capacity の coverage map | Capacity_Metrics（status） | `not_disclosed` の可視化 |

## 6. 動画構成と各パートの根拠データ

1. **Hook**: 「設備投資○兆円」より「何個作れるようになるのか」。→ Visual 1
2. **CapEx は入口**: 同額でも fab 新設・node migration・HBM packaging・EUV・maintenance で変換経路が違う。→ CapEx_Events の用途分類
3. **HBM 三社を数量で追う**: 投資発表 → capacity → 世代 → shipment → revenue を同一時間軸。→ Visual 2
4. **TSMC をつなぐ**: HBM だけでは accelerator は完成しない。wafer / CoWoS を接続。→ Visual 3, 7
5. **利益へ変換**: utilization / ASP / mix / yield を経由して revenue / op income / EPS へ。→ Visual 4, 5
6. **Valuation**: Forward EPS 成長と Forward PER を同じ時間軸で。→ Visual 6

制約: 投資推奨ランキングにはしない。個別銘柄の売買示唆を含めない。

## 7. Research Tasks（Issue 記載の作業を実行順に分解）

| 順 | 作業 | 完了条件 | 依存 |
|---|---|---|---|
| R1 | 全テーブル再監査（重複・期間・通貨・単位・source 欠落） | 監査レポートが全テーブルで PASS | なし |
| R2 | issuer_id 不一致・重複の修正 | Issuer_Master との結合不一致 0 | R1 |
| R3 | SK hynix M15X / Yongin の一次資料収集 | source_url・as_of_date 付きで capacity 行が登録、未開示は `not_disclosed` | R2 |
| R4 | Samsung Pyeongtaek / HBM capacity の一次資料収集 | 同上 | R2 |
| R5 | Micron Tongluo / Singapore / US の一次資料収集 | 同上 | R2 |
| R6 | TSMC wafer / CoWoS capacity の一次資料収集 | 同上 | R2 |
| R7 | HBM4 / HBM4E の product / customer 関係を canonical 化 | Products_SupplyChain に一意の世代表現 | R3–R6 |
| R8 | NVIDIA / AMD / Broadcom / Marvell を需要側へ接続 | Demand_Commitments で供給網と結合 | R7 |
| R9 | revenue / operating income / EPS / FCF actual 接続 | Financials の status が actual | R2 |
| R10 | forward EPS / revenue estimate / PER / PEG を別レイヤーで接続 | Estimates_Valuation が consensus として分離 | R9 |
| R11 | price / YTD / 1M / 1Y / drawdown を Market_Prices から取得 | 取得日が明示 | R2 |
| R12 | coverage 率と時系列断絶の自動監査 | 監査スクリプトが閾値判定 | R3–R11 |
| R13 | dbt で canonical test / lineage / mart を再現可能にする | `dbt test` PASS | R12 |
| R14 | yt3 chart input を正本 DB から生成 | 生成コマンド 1 本で再生成可能 | R13 |

並列化の目安: R3–R6（企業別の一次資料収集）は企業ごとに独立しており、ファイル所有を分けて並列実行できる。R9・R11 も独立。

## 8. Acceptance Criteria と検証方法

| 受け入れ基準 | 検証方法 |
|---|---|
| 最低4社で CapEx→Capacity→Revenue→EPS→Forward PER が一本につながる | Mart の結合チェックで4社以上が全段埋まること |
| HBM 三社を同一定義または単位差を明示して比較できる | 単位列の値と注記の有無を監査 |
| TSMC advanced packaging を需要側 GPU/ASIC へ接続できる | Demand_Commitments との結合件数 |
| actual / guidance / consensus / inference が混在しない | status 列の値域テスト |
| 全数値に period と source がある | 欠損 0 のテスト |
| 未開示 capacity を推測値で補完しない | `not_disclosed` 行に数値がないことのテスト |
| DB と動画チャートの数値が一致する | チャート入力生成後の突合（差分 0） |
| dbt test PASS | `dbt test` の実行ログ |
| factual QA PASS | 動画台本の数値を Sources と突合 |
| yt3 canonical pipeline から再生成可能 | 生成コマンドの再実行で同一出力 |

## 9. 未決事項とリスク

- **UNVERIFIED**: 本書は Google Sheets 正本の現在値を読んでいない。テーブルの現行列名・行数・監査状態は未確認。
- **UNVERIFIED**: M15X / Yongin / Pyeongtaek / Tongluo 等の capacity 数量が一次資料で開示されているかは未確認。開示が無い場合は `not_disclosed` とし、動画の主張を弱める。
- **UNVERIFIED**: HBM4 / HBM4E の世代名・出荷時期は一次資料での確認が必要。
- 単位混在（wafer/month と bits と packages/month）は直接比較できない。比較は同一単位の範囲に限る。
- Google Sheets を正本とする以上、dbt の入力経路（Sheets 取り込みの方法）を先に決める必要がある。
- 企画タイトル候補は3案（Issue 記載）。採用はユーザー判断。

## 10. 次の一手

1. R1（全テーブル監査）を最初に実行する。以降の作業はその結果に依存する。
2. R3–R6 を企業別に分担する（ファイル所有を分ける）。
3. 監査 PASS 後に R13・R14 へ進み、動画用チャート入力を生成する。
