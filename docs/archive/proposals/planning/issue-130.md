# Issue #130 計画書: DRAM × 日経半導体ETF × 楽天SOX を8社の実保有比率で分解する

対象 Issue: #130 「動画ネタ: DRAM × 日経半導体ETF × 楽天SOXを8社の実保有比率で分解する」

## 0. 前提と検証状況

- 本書は Issue 本文の記述をもとに作成した計画書である。Issue 内の「確認済み」項目は Issue 作成者の記載であり、本書では再検証していない。
- 組入比率・経費率・基準日などの数値は、本書では一切確定しない。制作 run で一次資料から取得する。
- 以下は本書時点で **UNVERIFIED**:
  - DRAM の launch 日、経費率 0.65%、対象領域
  - 221A の指数構成（国内半導体関連30銘柄）
  - 楽天・プラス・SOX の月次レポート有無と対象
  - 8社×3商品の weight 全数値
  - 各ETFの最新組入銘柄と比率

## 1. 目的

「半導体ETF3本は結局どれが同じなのか」を、3商品の実保有銘柄で説明する動画を実装する。

中心の見方は次の3行とする（Issue 記載の仮説。制作時に実データで検証する）:

- 楽天SOX = 半導体コア（米国上場中心）
- DRAM = メモリ/HBM 側のオーバーウェイト
- 221A = 日本の装置・材料側のオーバーウェイト

出力は「商品名」ではなく「欲しい企業 → 入る商品 → 重複 → 抜け → 役割差」の順で見せる。

## 2. スコープ

含める:

- 対象8社（MU / TSM / NVDA / AMAT / LRCX / KLAC / 東京エレクトロン / SK hynix）の3商品 weight 取得
- 8×3 coverage matrix（機械可読データ + 表示用）
- top holdings 比較、value-chain 分類、look-through 重複計算
- コスト（経費率・信託報酬）比較と source 記録
- 16:9 本編用 visual plan、9:16 Short 派生用の matrix cut
- 本編台本の骨子（Issue の動画構成 0:00〜6:00 に準拠）

含めない（別 Issue または対象外）:

- 投資推奨・ランキング・「買うべき」表現
- 為替・税・売買コストの詳細計算（必要時のみ注記）
- Comedy Beat の新規実装（#128 実装済みの場合のみ、1か所適用）

## 3. データ設計

### 3.1 正本スキーマ

Issue の research 項目をそのまま正本フィールドとする。1商品×1銘柄×1基準日を1レコードとする。

| field | 型 | 説明 |
|---|---|---|
| as_of | date | 組入比率基準日 |
| product | string | 商品名 |
| ticker | string | ティッカー/コード |
| benchmark | string | 指数名または運用方針 |
| expense_ratio | number (%) | 経費率/信託報酬。実質コストとは別概念 |
| holding | string | 組入銘柄（正規化した企業ID） |
| weight | number or null | 組入比率。未取得は null（0 と区別） |
| exposure_type | enum | direct / swap / etf_of_etf / unknown |
| country | string | 国 |
| value_chain | enum | memory / logic / foundry / equipment / material |
| source_url | string | 一次資料 URL |
| source_date | date | 資料の日付 |

保存先は `config/` 配下の定義と `runs/<run_id>/` 配下の出力に分ける。正本は1つだけとし、重複コピーを作らない。

### 3.2 企業正規化

- 同一企業の ADR と現地株は `company_id` で集約する。原株の `ticker` と上場形態は別フィールドで保持する。
- TSMC（TSM ADR / 2330 台湾株）は集約時に注記を付ける。
- SK hynix は韓国株のみを対象とし、重複計上を検査する。

### 3.3 一次資料の取得

- 制作 run ごとに、動画生成日から最も近い公式月報 / holding CSV を再取得する。
- 取得元: DRAM = Roundhill 公式、221A = アセットマネジメントOne/MUFG 系の公式（Issue 記載の URL は `https://www.am.mufg.jp/`。個別ファンドページの特定は UNVERIFIED）、楽天SOX = 楽天投信投資顧問 公式（`https://www.rakuten-toushin.co.jp/fund/nav/rirsox/`）。
- 古いブログ・まとめサイトは正本にしない。
- 取得できなかった項目は `weight = null` と `source_date` の欠落で明示し、推定値で埋めない。

## 4. 成果物

| # | 成果物 | 内容 | 検証 |
|---|---|---|---|
| A | 正本 holdings データ（3商品） | 3.1 スキーマ、source_url / source_date 付き | スキーマ検査、source 欠落 0 件 |
| B | 8×3 coverage matrix（機械可読） | 企業 × 商品 の weight | 0% と null の区別を検査 |
| C | 8×3 matrix 表示（16:9 / 9:16） | 表示ルール準拠の図 | 描画確認 |
| D | top holdings 比較 | 3商品の上位銘柄 | 比率合計の整合 |
| E | value-chain 分類 | memory / logic / foundry / equipment / material | 全銘柄分類済み |
| F | look-through 重複計算 | 配分入力に応じた重複・日本比率・メモリ比率 | 計算例であることを画面表示 |
| G | コスト比較 | 経費率・信託報酬。実質コストは別列 | 出典付き |
| H | 本編台本 + visual plan | Issue の 0:00〜6:00 構成 | 投資推奨表現なし |

## 5. 表示ルール

- 0% と「データ未取得」は別の表示にする。
- 直接保有と swap 等による実質 exposure を分けて表示する。DRAM は stock holding と swap exposure を混同しない。
- ADR と現地株を集約した場合は注記する。
- source date と source URL を画面または概要欄に表示する。
- look-through 計算は「構造説明用の計算例」と明示し、投資推奨と読める文言を使わない。
- 本編の締めは商品名の推奨ではなく「半導体のどの工程を厚くしたいか」とする。最終台詞は source-backed data に合わせて生成する。

## 6. 作業分割（agent team）

ファイル所有を分けて並列に進める。同一ファイルを複数 agent が編集しない。

| 担当 | 所有ファイル（案） | 作業 |
|---|---|---|
| research | `runs/<run_id>/` の一次資料ダンプ、取得スクリプト | 3商品の一次資料取得、source_url / source_date |
| data | 正本スキーマ定義、企業正規化、value-chain 分類 | 3.1〜3.2 の実装と検査 |
| calc | look-through 重複・コスト計算 | F / G の計算ロジックとテスト |
| visual | matrix 描画（16:9 / 9:16） | C の図 |
| script | 本編台本・visual plan | H |
| QA | factuality / source-policy 検査 | 受け入れ基準の検証 |

ファイルパス（`config/`、`src/`、`tests/`）は実装着手時に確定する。本書の段階では確定しない。

## 7. 受け入れ基準の対応

Issue の Acceptance Criteria と成果物の対応:

| 受け入れ基準 | 対応成果物 | 検証方法 |
|---|---|---|
| 3商品の最新一次資料を取得 | A | source_url / source_date の存在確認 |
| 8社の3商品 weight を機械可読化 | A, B | スキーマ検査 |
| 8×3 coverage matrix | B, C | 検査 + 描画確認 |
| top holdings 比較 | D | 出力確認 |
| value-chain 分類 | E | 全銘柄分類の検査 |
| look-through 重複比率の計算 | F | 単体テスト（既知の入力と出力） |
| expense ratio / 信託報酬の比較 | G | 出典付き値の確認 |
| source date と URL の保存 | A | スキーマ検査 |
| SOX で SK hynix / 東京エレクトロンを直接拾えない理由の説明 | H | 台本と組入データの照合 |
| DRAM のメモリ集中性の説明 | H | 組入データの照合 |
| 221A の日本装置・材料側の役割説明 | H | 組入データの照合 |
| 特定商品の購入推奨で締めない | H | 文言検査 |
| factuality / source-policy QA PASS | QA | QA 記録 |
| #128 実装済みなら Comedy Beat 最大1個 | H | #128 の状態確認 |
| 16:9 本編用 visual plan | H | 出力確認 |
| 9:16 Short 派生用 matrix cut | C | 出力確認 |

## 8. リスクと未決事項

- ETF 公式の開示形式（CSV / PDF / Excel）が変わると取得が壊れる。取得失敗時は run を失敗させ、古い値で埋めない。
- DRAM の swap exposure の扱い（開示の有無と粒度）は UNVERIFIED。開示がない場合は `exposure_type = unknown` とする。
- 221A の指数構成変更の反映時期は UNVERIFIED。基準日との差を `source_date` で明示する。
- 為替・税・売買コストの扱いは未決。必要なら別注記とする。
- #128 の完了状態は本書時点で未確認。Comedy Beat の適用可否は #128 の状態で決める。

## 9. 完了条件

視聴者が動画終了時に、次の役割差を実保有銘柄と比率で説明できること:

- SOX = 半導体全体のコア
- DRAM = メモリ/HBM を濃くする
- 221A = 日本の装置・材料を濃くする

本書の範囲は計画までとする。データ取得・実装・動画生成は別作業とし、公開や投稿は行わない。
