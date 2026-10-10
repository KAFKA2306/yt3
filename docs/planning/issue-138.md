# Issue #138 企画: Google Financeで日本株が取れないのをADR・OTC・欧州上場で迂回する

対象: GitHub Issue #138
状態: 企画定義のみ。動画の制作・公開、スプレッドシートの再計算、GOOGLEFINANCE の再実行は行っていない。
位置づけ: 投資推奨ではなく、データ取得基盤（quote provider の fallback 設計）の検証として扱う。

## 1. 目的と範囲

- 目的: 東証コードで GOOGLEFINANCE が空になる問題を、同一企業の海外上場証券へ迂回して救えるかを実測し、動画と設計指針にする。
- 範囲: 実測結果の検証方法、動画構成、ADR 比率・為替の注意点、推奨アーキテクチャ、完了条件の進捗。
- 非範囲: 売買判断、銘柄の推奨、Issue 本文の数値の独自再監査（後述の UNVERIFIED を除く）。

## 2. Issue 記載の実測値の整合性チェック

Issue 本文の数値を、内部の整合だけで確認した。外部シートとの照合はしていない。

| 項目 | Issue 記載 | 整合性 |
|---|---|---|
| 東証ユニークコード | 94 | 個別株 74 + ETF/REIT 20 = 94。整合 |
| ADR 経由で価格取得成功 | 40 | ADR 確認 42 のうち 40。残り 2 銘柄は ADR ありでも価格なし（記載 #6 と一致） |
| 海外代替上場で価格取得成功 | 22 | 代替上場あり 26 のうち 22 |
| 個別株の海外経由成功 | 62 | 40 + 22 = 62。整合 |
| 成功率 | 約84% | 62 / 74 = 83.8%。整合 |
| 未分類 | 記載なし | ADR 42 + 代替 26 = 68 で、個別株 74 との差 6 銘柄は Issue に記載がない。UNVERIFIED |

- UNVERIFIED: ADR 42 と代替 26 が個別株 74 に含まれるか、ETF/REIT を含むかは Issue 本文だけでは確定しない。動画では分母を「個別株 74」と明示する。
- UNVERIFIED: 差の 6 銘柄の内訳（海外代替なし、または価格取得失敗）。ADR_Audit タブで確認が必要。
- 注意: 「取得成功」は価格が返ったことのみを意味する。価格の正しさ、更新頻度、取引時間は別に検証していない。

## 3. 一次ソースと外部事実の到達確認

| 項目 | 状態 |
|---|---|
| 検証シート（Securities_Master / ADR_Audit） | 未アクセス。Issue 記載の列定義のみ使用 |
| 代表 ticker（Sony NYSE:SONY、SoftBank Group OTCMKTS:SFTBY 他） | Issue 記載のまま。UNVERIFIED（現行の ticker・上場状況は未確認） |
| Kagome の FRA:5EW | UNVERIFIED |
| GOOGLEFINANCE の対応範囲（Web と Sheets の差） | UNVERIFIED。公式ドキュメントでの確認は未実施 |
| ADR 比率・為替換算 | 一般的な注意点として記載。個別銘柄の比率は UNVERIFIED |

## 4. 動画構成（完了条件に対応）

| 章 | 内容 | 完了条件 |
|---|---|---|
| 1. 問題提起 | `GOOGLEFINANCE("TYO:xxxx")` が空になることを示す | — |
| 2. 発想転換 | 「企業」ではなく「同じ企業を表す別の証券」を探す。東証 → ADR → OTC F-share → 欧州上場 → 日本株 API の順 | 図解 |
| 3. 全件監査 | 94 コードを一つずつ探索。ADR 42、代替上場 26 を発見 | 集計値を動画時点で再計算 |
| 4. 実演 | Sheets で代表 5 銘柄を `GOOGLEFINANCE` で実行。東証で空、米国 ticker で値が返る対比 | 代表 5 銘柄の実演 |
| 5. 罠 | ADR 価格 ≠ 東証株価。ADR 比率、USD/JPY、取引時間、流動性、非スポンサー ADR を分離 | 比率・為替の注意点 |
| 6. 結論 | Google Finance は日本企業に弱いのではなく「東証という入口」に弱い | Web と Sheets の差を示す |

- 代表 5 銘柄（案）: Sony（ADR）、Tokyo Electron（OTC）、Renesas（OTC）、Kagome（欧州）、SBI Holdings（OTC）。いずれも実演前に現行の取得結果を再確認する。
- 絶対価格の比較は行わない。騰落率の代理としてのみ使うと明示する。
- 図解は drawio など既存の図解ツールで作る（ツール指定は AGENTS.md / 運用ルールに従う）。

## 5. 推奨アーキテクチャ（設計指針）

```
canonical security（正本: 日本株の canonical_id）
  ↓ primary listing で取得
  ↓ fail
ADR（quote provider）
  ↓ fail
OTC F-share（quote provider）
  ↓ fail
EU cross-listing（quote provider）
  ↓ fail
JPX / 日本株 quote source
```

- 銘柄 ID と価格取得先を分離する。
- ADR を正本銘柄にしない。正本は日本株の canonical_id のまま維持し、ADR 等は quote provider として扱う。
- fallback の採用結果（どの provider で取れたか）を fallback_type と source に記録し、追跡可能にする。
- 価格を比較・表示する際は、provider 種別ごとに ADR 比率と為替換算を必須にする。換算できない場合は値を出さない（エラーを隠すフォールバック表示は禁止）。

## 6. データ構造（ADR_Audit 列定義）

Issue 記載の列: `adr_symbol`, `adr_price`, `adr_ratio`, `adr_program`, `adr_audit_status`, `fallback_symbol`, `fallback_type`, `fallback_price`, `fallback_status`, `source`

- 正本はどのデータを使うかを一つに決める。Sheets の集計値を動画の正本とし、repo 側に複製しない。
- `adr_ratio` が空の行は絶対価格の比較に使わない。
- 実装側に同等のスキーマを置く場合は、config/ 側で定義し、ハードコーディングしない。

## 7. 注意点（動画・記事の必須記載）

- ADR 価格は東証株価ではない。ADR 比率、USD/JPY、取引時間、流動性の差がある。
- 非スポンサー ADR は発行体の関与がない場合があり、情報の質が変わる可能性がある（UNVERIFIED: 対象銘柄ごとの program 種別）。
- 投資推奨ではない旨を冒頭と結論で明記する。

## 8. 完了条件の進捗

| 完了条件 | 状態 |
|---|---|
| ADR_Audit の集計値を動画時点で再計算 | 未実施（シート未アクセス） |
| ADR / F-share / cross-listing の違いを図解 | 未実施（構成のみ定義） |
| 代表 5 銘柄で GOOGLEFINANCE 実演 | 未実施 |
| ADR 比率と為替補正の注意点を説明 | 構成と注意点を定義済み |
| Google Finance Web と Sheets 関数の差を示す | 未実施（UNVERIFIED） |
| 取得成功率を Before/After で可視化 | 未実施（集計値は Issue 記載の 62/74 を使用可） |
| 投資推奨ではなくデータ取得基盤の検証として構成 | 本ドキュメントで方針定義済み |

## 9. 残件と次の作業

1. ADR_Audit の 94 行を再読し、Issue の集計値（特に 6 銘柄の差分）を照合する。
2. GOOGLEFINANCE の対応範囲について、公式ドキュメントで Web と Sheets の差を確認する。
3. 代表 5 銘柄の ticker と取得結果を、動画撮影直前に再確認する。
4. 図解を作成し、成功率の Before/After を可視化する。
5. 動画公開は別途明示的な承認を得てから行う（本企画では実施しない）。
