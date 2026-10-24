# Issue #136 計画: NVIDIA投資先のYTDと資本循環の検証動画

対象: GitHub Issue #136 「NVIDIA投資先のYTDと資本循環を検証し『AI需要そのものを作る投資戦略』を動画化する」
ステータス: 計画のみ。本ファイルでは外部データの再確認・株価取得・投稿・公開は行っていない。

## 1. 目的と非目的

- 目的: NVIDIAの投資先10社について、投資の性質と2026年YTD株価を実データで検証する動画を作る。
- 中心仮説: NVIDIAが買っているのは「株」ではなく、将来のGPU需要・ネットワーク需要・AI factoryの建設能力である。
- 非目的: 投資推奨。NVIDIA出資と株価上昇の因果の断定。

## 2. 検証する問い

NVIDIAの投資は次のどれに近いか。

1. 純粋な金融投資
2. 顧客への資金供給
3. NVLink / CUDA / GPU需要を拡大する戦略投資
4. 電力・データセンター・光通信を含むAI factoryの垂直統合

判定は案件ごとに行い、全体を一括で断定しない。

## 3. 対象銘柄と役割分類

スナップショット基準日: 2026-09-22（Issue本文の記載値。本計画では再取得しない）

| 役割 | 企業 (Ticker) | Issue記載の2026 YTD（snapshot） | NVIDIAとの関係（Issue記載） |
|---|---|---:|---|
| Compute | MediaTek (2454.TW) | 約+278% | custom compute / NVLink Fusion |
| Compute | Intel (INTC) | 約+230% | CPU / semiconductor infrastructure |
| Compute | Marvell (MRVL) | 約+203% | networking / custom silicon |
| Cloud | Nebius (NBIS) | 約+178% | AI cloud / datacenter |
| Optical | Lumentum (LITE) | 約+159% | optical networking |
| Optical | Coherent (COHR) | 約+74% | optics / photonics |
| Network / RAN | Nokia (NOK) | 約+69% | AI-RAN / telecom |
| Datacenter & Power | IREN (IREN) | 約+25% | AI datacenter / power |
| Cloud | CoreWeave (CRWV) | 約+19% | AI cloud |
| Design software | Synopsys (SNPS) | 約-14% | EDA / engineering software |

- 役割分類はIssue記載のものを採用する。Marvellは networking を含むため Compute に置くかどうかを台本作成時に再判断する（UNVERIFIED の分類判断）。
- MediaTekは2454.TWのため、為替・取引時間・データ提供元による値差がある。取得時刻とsourceを必ず併記する。

## 4. 指標の定義

| 指標 | 定義 | 注意 |
|---|---|---|
| 2026 YTD | 2025-12-31終値 → 最新取得値 | 最新取得値の時刻を明記 |
| 発表後騰落率 | 投資発表日の終値 → 最新取得値 | YTDと混同しない |
| 比較の原則 | 「2026 YTD」と「出資後騰落率」を別グラフ・別表で示す | 同一軸に混ぜない |

## 5. 投資案件のデータ項目 (canonical schema)

各社について次の項目を埋める。未確定の項目は空欄にせず `unknown` と書く。

```
company
ticker
investment_announcement_date
investment_amount
instrument                 # common_equity / convertible / purchase_right / commitment / strategic_agreement など
ownership_or_commitment    # 実保有 / 未実行の commitment を区別
nvidia_product_relationship
gpu_purchase_commitment
capex_plan
datacenter_capacity
power_capacity
price_at_announcement
latest_price
return_since_announcement
ytd_return
primary_source_url
source_date
confidence                 # confirmed / inferred / unknown
```

保存先の方針: 上記を1ファイル（CSVまたはYAML）のデータ正本として `yt3` リポジトリ内に置き、チャート生成スクリプトがそこから読む構成とする。Google Sheetsは閲覧用の派生物とし、数値の正本にはしない（二重正本を避ける）。配置先は実装時に `docs/standard/repository-layout-standard.md` に従って決める（UNVERIFIED: 具体的なパスは未決）。

## 6. 章構成と各章の要点

1. **Hook**: 「NVIDIAが投資した会社、2026年にどれだけ上がった？」。10銘柄のYTDバーを一度に出す。
2. **異常値**: MediaTek / Intel / Marvell / Nebius / Lumentum の大幅上昇を示す。直後に「NVIDIA出資だけが理由ではない」と明示する。
3. **役割別の再分類**: 「企業名一覧」から「AI factory部品表」へ見せ方を変える（Compute / Cloud / Datacenter & Power / Optical / Network・RAN / Design software）。
4. **NVIDIAの狙い**: 各社について、投資額・投資日・証券形態・製品関係・購入者か・設備投資計画・発表後騰落・戦略価値を1枚にまとめる。
5. **Circular financing**: 「出資 → GPU購入 → NVIDIA売上」の循環が案件ごとにどこまであるかを検証する。各項目を confirmed / inferred / unknown に分ける。
6. **Conclusion**: NVIDIAを `GPU + networking + optics + cloud + power + capital allocator` として捉えると投資行動を説明できるかを、検証結果としてまとめる。断定は避け、説明力の評価に留める。

## 7. 必要なVisual (6点)

1. NVIDIA投資先 YTD bar chart
2. NVIDIA ecosystem map
3. NVIDIA → 投資先 → NVIDIA製品購入 の capital loop 図
4. Compute / Cloud / Optical / Network / Power / EDA のstack図
5. 投資日を軸にしたtimeline
6. 「出資後騰落率」と「2026 YTD」を分けた比較図

図の作成は既存の図解・チャートの方針に従う（drawio等の既存ツールを優先）。

## 8. 検証手順

1. 10社それぞれについて、NVIDIA投資の事実（投資日・額・形態）を primary source（企業のプレスリリース、SEC提出書類、NVIDIAの公式発表など）で確認する。二次情報だけで確定させない。
2. 投資形態を common equity / convertible / purchase right / commitment / strategic agreement に分類し、同一扱いしない。
3. 投資発表日の終値を取得する（取得元と取得時刻を記録）。
4. 最新株価、YTD、発表後騰落率を計算する。計算式は本計画 §4 に従う。
5. NVIDIA製品の購入関係を confirmed / inferred / unknown で分類する。
6. 6種類のVisualを生成する。
7. 動画内の全数値に取得日を付与する。
8. Google Sheetsの表示値と動画用データの数値が一致することを照合する。
9. 「株価上昇 = NVIDIA出資効果」と読める表現がないかレビューする。

## 9. 禁止事項の反映

- 因果の断定をしない（台本・字幕・サムネイルすべてで確認する）。
- 未確定の commitment を保有株と混同しない。
- 普通株・転換社債・purchase right・strategic agreement を同一扱いしない。
- YTD と発表後リターンを混同しない。
- 二次情報のみで投資額・契約条件を確定しない。

## 10. Acceptance Criteria と対応

| # | 受け入れ条件 | 対応方針 | 現状 |
|---|---|---|---|
| 1 | 10社すべての投資関係を primary source で再確認 | §8-1。出典URLを canonical データに保存 | 未着手 |
| 2 | equity / convertible / commitment / strategic agreement を分類 | §5 `instrument` 項目 | 未着手 |
| 3 | 投資発表日と投資額を確定 | §8-1 の結果で確定。確定不能は `unknown` | 未着手 |
| 4 | 発表日終値を取得 | §8-3 | 未着手 |
| 5 | 最新株価・YTD・発表後騰落率を計算 | §4 の定義で算出 | 未着手 |
| 6 | NVIDIA製品購入との関係を confirmed / inferred / unknown で分類 | §5 `confidence` | 未着手 |
| 7 | 6種類のVisualを生成 | §7 | 未着手 |
| 8 | 動画内の全数値に取得日を付与 | §8-7 | 未着手 |
| 9 | Google Sheetsと動画用データの数値一致を検証 | §8-8 | 未着手 |
| 10 | 誤認させる表現がないことをレビュー | §8-9 | 未着手 |
| 11 | yt3 で再生成可能なデータ・チャート入力として保存 | §5 の保存方針 | 未着手 |

## 11. 未確定事項 (UNVERIFIED)

- 10社それぞれの NVIDIA 投資額・投資日・証券形態: Issue 本文には記載なし。本計画では一切確定しない。
- Issue記載のYTD値（snapshot 2026-09-22）: 本計画では再確認していない。動画用には再取得が必要。
- Google Sheets の `Tracker` / `Snapshot_2026-09-22` の現在内容: 本計画では閲覧していない。
- MediaTek の YTD 値の提供元差: 値差の大きさは未確認。
- 役割分類（特に Marvell の Compute 配置）: Issue の分類を暫定採用。

## 12. 次の作業の分担案

- 調査担当: §8-1 から §8-3 の primary source 確認と株価取得。出典URLと取得時刻を必ず記録する。
- データ担当: §5 のデータ正本ファイル作成と、§4 の計算ロジック。
- 図表担当: §7 の6種類のVisual。データ正本のみを入力とする。
- レビュー担当: §8-9 の表現チェックと §8-8 の数値照合。

各担当は書き込み対象ファイルを分けて、同一ファイルを複数人で編集しない。
