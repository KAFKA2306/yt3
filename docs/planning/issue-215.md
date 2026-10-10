# Issue #215 企画・検証計画: AIインフラ14社を同じルールで再選考

対象: https://github.com/KAFKA2306/yt3/issues/215 (リポジトリ: `/home/kafka/2511youtuber/v3/yt3`)
性質: 動画企画の計画書。投資推奨ではない。

## 1. 目的と問い

- 目的: AIインフラ14社を同一の6軸ルールで採点し、残す会社・入れ替える会社・見送る会社の理由を動画で説明する。
- 中心の問い: 同じ基準で再選考すると、NVIDIA以外に何を残すべきか。「良い会社なのに採用しない」のはなぜか。
- 視聴者が得る結論: 各社がどのボトルネックを取り、他の保有銘柄と何が重複し、何が補完するのか。

## 2. 対象銘柄 (14社)

Issue記載の選考結果をそのまま採用する。

| 区分 | 銘柄 |
|---|---|
| KEEP | MU, COHR, NVDA, AVGO, CEG |
| ADD | LITE, 000660.KS (SK hynix), HPE, SNPS |
| REMOVE | AMD, SNDK, GLW, VST |
| WATCH | SU.PA (Schneider Electric) |

14社 = KEEP 5 + ADD 4 + REMOVE 4 + WATCH 1。ADD と REMOVE が各4社で、タイトルの「4社が入れ替わった」と一致する。

## 3. 評価ルール

### 3.1 6軸

| 軸 | 性質 | 本計画での扱い |
|---|---|---|
| AI純度 | Fact + scoring rule | AI関連の売上・受注の比率を一次情報から引く。比率の算出式は事前に固定する |
| 契約・受注・量産などの実証度 | Fact + scoring rule | 長期契約、量産開始、顧客採用などの一次情報を根拠にする |
| Fundamental | Fact | 財務指標は一次情報（決算資料・IR）へ遡れること |
| Technical | Fact + scoring rule | RSI / SMA / SOXX相対強度。全銘柄で同一期間・同一式を使う |
| ポートフォリオ補完性 | Portfolio judgment | 役割重複の有無で判定する。採点ではなく判断として明示する |
| 過熱ペナルティ | scoring rule | 過熱の定義（例: RSI・価格乖離）を事前に固定し、減点幅を定める |

UNVERIFIED: 各軸の重み、点数スケール、各閾値の具体値はIssueに記載がない。実装前に Sheet の `selection` タブで確定する必要がある。

### 3.2 判定の原則 (Issueの Evidence Rules より)

- 投資推奨と表現しない。
- Fact / scoring rule / portfolio judgment を画面と台本の上で分けて示す。
- Score上位 = 必ず採用、としない。
- 役割重複とポートフォリオ補完性を明示する。
- RSIだけで売買判断しない。

## 4. ポートフォリオ

### 4.1 Current (Issueの Current Virtual Portfolio)

| 銘柄 | 比率 |
|---|---|
| MU | 15% |
| COHR | 15% |
| LITE | 10% |
| NVDA | 10% |
| AVGO | 10% |
| SK hynix | 7.5% |
| HPE | 7.5% |
| SNPS | 7.5% |
| CEG | 7.5% |
| CASH | 10% |

合計 100% (確認済み: 15+15+10+10+10+7.5×4+10 = 100)。

### 4.2 Before

UNVERIFIED: AMD, SNDK, GLW, VST の旧比率、および旧ポートフォリオの現金比率はIssueに記載がない。Sheet の `portfolio` タブ（履歴があれば）から取得する。取得できない場合は Before 画面を作らず、その旨を台本に残す。

## 5. 採用・除外の理由 (Issue記載の内容)

- AMD (REMOVE): NVIDIAと計算レイヤーが重複。別レイヤーへ配分する。
- SNDK (REMOVE): HBF/Flashは将来性があるが実証待ち。MU・SK hynixより確度が低い。
- GLW (REMOVE): AI光需要は強いが、COHR/LITEよりAI純度・直近モメンタムで劣る。
- VST (REMOVE): CEGと電力テーマが重複。電力枠は CEG に集約する。
- LITE (ADD): AI光通信の中心。1.6T/OCSを含む高成長と強いテクニカル。
- SK hynix (ADD): HBM4量産と長期契約。HBM純度が高い。MUと競合する点も明示する。
- HPE (ADD): AIラックとData Center Networkingを取れる「システム側」の露出。
- SNPS (ADD): AIカスタムシリコン増で設計複雑性が増える分をEDA/IPで取る補完枠。
- Schneider (WATCH): データセンター電力のFundamentalは強いが、Technicalが弱気。エントリー条件は別に扱う。

事実確認が必要な箇所 (UNVERIFIED, 一次情報で確認するまで台本に断定表現を使わない):
- LITEの「1.6T/OCS」、SK hynixの「HBM4量産と長期契約」、HPEの「AI Rack」、SNPSの「AI custom silicon」に関する数値・契約の有無。
- 各社のAI純度・実証度の数値。

## 6. 台本と映像の対応

| # | 尺の目安 | 内容 | 必要な図 |
|---|---|---|---|
| 0 | Hook | 「全部買えばいい？」への答え（重複リスク） | なし |
| 1 | 14社を同じルールに乗せる | 6軸の説明 | 図1: 14社の選考ランキング |
| 2 | 上位でも買わない会社 | 過熱・役割重複 | 図6: 高順位でも除外の例 |
| 3 | 下位でも残す会社 | CEGの例（電力ボトルネック） | 図6: 低順位でも残す例 |
| 4 | 4社入替 | AMD/SNDK/GLW/VST → LITE/SK hynix/HPE/SNPS | 図2: 4象限 |
| 5 | 最終ポートフォリオ | Compute/Memory/Optical/System/EDA/Power の役割地図 | 図3: Before→After, 図4: 役割地図 |
| 6 | Conclusion | 異なるボトルネックを組み合わせる | なし |

採用理由カード（図5）は銘柄ごとに、区分・6軸の根拠・出典を1枚にまとめる。テクニカル例（図7）はRSI / SMA / SOXX相対強度を同一期間で示す。

## 7. Acceptance Criteria の対応

| 受け入れ条件 | 計画上の対応 |
|---|---|
| 14社を同一ルールで比較 | 3.1 の6軸を全14社に適用 |
| 6軸の採点根拠を説明 | 3.1 と採用理由カード |
| ADD 4社の採用理由 | 5節 |
| REMOVE 4社の除外理由 | 5節 |
| CEGを残す理由（補完性） | 5節・図6。役割重複の観点で説明 |
| SchneiderをWATCHにする理由 | 5節。Technicalの弱気を根拠に、Fundamentalとは分けて説明 |
| Before/Afterを1画面で比較 | 図3。4.1 と 4.2 を並べる |
| 全主要Factにsource/provenance | 各Factに一次情報のURLと取得日を付ける（後述 8節） |
| 投資推奨表現を回避 | 台本・画面の文言レビュー |
| factual QA PASS | 8節の検証手順 |
| script linter PASS | 台本の禁止表現・Fact/判断の分離をチェック |
| render smoke PASS | 図の描画確認 |
| 実動画E2E PASS | 動画の生成と視聴確認 |

## 8. 出典とデータ

- 正本: Google Sheet (`portfolio`, `technical`, `selection`, `trades`, `ideas`)。Issueの URL を参照する。
- Fundamentalは一次情報（決算資料・IR・公式発表）まで遡る。二次情報（まとめ記事）のみの数値は採用しない。
- Technicalは全銘柄で同一期間・同一式で計算する。計算式と期間は `technical` タブに明記する。
- 取得日を全 Fact に付ける。株価・指標は取得時点で変わるため、動画の基準日を1つ決める。
- 認証情報や Sheet への書き込み権限は本計画では扱わない。読み取りのみを前提とする。

UNVERIFIED: Sheet の現在の中身（各タブの行数、値、基準日）は本計画作成時点で確認していない。

## 9. 作業分担案 (ファイル単位の担当)

並列化する場合、同一ファイルを複数人に割り当てない。

| 担当 | 範囲 |
|---|---|
| データ取得 | Sheet の値の取得と出典の付与 (読み取りのみ) |
| 採点・検証 | 6軸のルール確定、一次情報の突き合わせ、factual QA |
| 台本 | 台本ファイル、禁止表現チェック |
| 図版 | 図1〜7の作成と render smoke |
| 統合 | 動画生成、E2E確認、最終報告 |

公開（YouTube投稿など）は本計画に含まれない。公開は別途、明示的な承認を得てから行う。

## 10. 未決事項

1. 6軸の重み・点数スケール・過熱の閾値 (UNVERIFIED)
2. Before のポートフォリオ比率 (UNVERIFIED)
3. 基準日（株価・指標の取得日）
4. 動画の公開可否と公開先の承認（本計画では公開しない）
5. 「投資推奨ではない」旨の免責文言の扱い

## 11. 完了の定義 (Done)

動画を見た人が、「AI関連だから全部買う」のではなく、各社がどのボトルネックを取り、他の保有銘柄と何が重複し、何が補完するのかを説明できること。
