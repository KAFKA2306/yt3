# Issue #163 計画書: NVII の NVDA 超過を Total Return・効率的フロンティア・Fama-French alpha で分解する

対象 Issue: #163 (`NVIIは本当にNVDAを超えたのか？ 高分配ETFを効率的フロンティアとFama-French alphaで分解する`)

## 0. 前提と未検証事項

- Issue 記載の数値（NVII +80.69%、NVDA +67.01%、VT +32.51%、最大DD など）は **UNVERIFIED**。本計画では一次データから再計算して確定する対象とし、数値はそのまま採用しない。
- 対象期間 2025-05-28〜2026-09-24 は約 1.3 年（取引日はおよそ 330 日、**概算・UNVERIFIED**）。標本が短いため、alpha の統計的有意性は弱くなりやすい前提で扱う。
- 一次資料 URL（Kenneth R. French Data Library、REX NVII 公式、YieldMax NVDY 公式）は Issue 記載のまま。本計画時点では取得・内容確認をしていない（**UNVERIFIED**）。
- ETF の分配方針・手数料・エクスポージャーは運用側の公表値に依存する。実装時に snapshot 保存して `retrieved_at` を記録する。
- 本計画は「NVII を買うべき」とする動画の設計ではない。目的は高分配 ETF の見かけの利回りを Total Return・フロンティア・factor alpha へ分解して検証すること。

## 1. 目的と非目的

目的:
- NVII / NVDA / NVDY / QQQ / VT の日次 Total Return を共通期間で再現する。
- リスク・リターン、効率的フロンティア、Fama-French 系 alpha を再計算可能な形で出す。
- 台本・チャート・サムネの全数値を canonical dataset / analysis output まで trace できるようにする。

非目的:
- 投資助言、売買推奨。
- 断定的な結論（「alpha は本物」など）の提示。結論は「観測値」「factor で説明できる部分」「option premium で説明できる部分」「統計的に残る alpha」「推定誤差」に分けて示す。
- Total Real Returns を回帰・最適化の正本にすること（表示確認用のみ）。

## 2. データ正本とマニフェスト

### 2.1 正本の固定

| 種別 | 正本 | 用途 |
|---|---|---|
| 日次価格・分配 | 1 本の reproducible source に固定（実装時に選定し、manifest に記録） | Total Return 構築 |
| ファクター | Kenneth R. French Data Library: US Daily FF5 と Daily Momentum | alpha 回帰 |
| 商品仕様 | REX NVII 公式、YieldMax NVDY 公式（戦略・分配・手数料・エクスポージャー） | 解釈・動画内の記述 |
| 表示確認 | Total Real Returns | sanity check のみ。回帰・最適化には使わない |

### 2.2 Total Return 構築

権利落ち日の cash distribution を含める。

```
r_t = (P_t + D_t) / P_{t-1} - 1
```

- `P_t`: split-adjusted close。
- `D_t`: 権利落ち日の現金分配（ex-dividend cash distribution）。
- 価格ソースに配当込み系列がある場合も、上式で自前再構築し、差分を確認する。

### 2.3 manifest に残す項目

- source URL、`retrieved_at`、対象期間（開始・終了）、取得した行数
- formula version（上式の版番号）
- FF データの終端日（この日より先は外挿しない）
- Total Real Returns との差分（後述 3.2）

## 3. 分析仕様

### 3.1 共通期間

- 全銘柄・全ファクターが揃う共通期間のみを使う。
- FF 公式データの終端日より後は使わない。

### 3.2 Total Real Returns との差分

- 表示値との差（期間リターン、年率換算）を一覧化し、差の要因（分配の扱い、価格ソース、期間定義）を説明する。
- 差が大きい場合は、自前再構築を正本として残し、差分理由を動画・description に明記する。

### 3.3 基本統計

銘柄ごとに出力する:
- 年率リターン、年率ボラティリティ、Sharpe、Sortino、最大 DD
- 相関行列（correlation matrix）

### 3.4 効率的フロンティア

- 対象: VT / QQQ / NVDY / NVDA / NVII
- 入力: 日次 Total Return から年率平均 `mu`、年率共分散 `Sigma`。
- 式: `E[R_p] = w^T mu`、`sigma_p^2 = w^T Sigma w`
- 制約: long-only、`sum(w)=1`。基本ケースはレバレッジなし。
- 別ケース: レバレッジ許容を比較（任意。基本ケースの後に実施）。
- 単体 ETF 点も同じ図に表示する。
- 既存の予備解析（NVDA はフロンティア上に残らない等）は仮説として扱い、本番データで再計算して確定する。

### 3.5 Alpha 回帰

- 日次、OLS、年率 alpha 表示。
- 標準誤差は **Newey-West / HAC**。ラグ数は実装時に固定して manifest に記録する（UNVERIFIED: 推奨ラグは実装時に決定）。
- 保存項目: alpha（年率・日次）、beta、t-stat、p-value、R²。
- 比較モデル:
  1. CAPM（MKT-RF）
  2. FF3 もしくは FF5（MKT-RF, SMB, HML, RMW, CMA）
  3. FF5 + Momentum（MOM を追加）
  4. NVDA-control（NVDA の日次 Total Return を control 変数として追加）
  5. NVDA + FF5 + Momentum

回帰式:
```
R_i - R_f = alpha + beta_MKT (MKT-RF) + beta_SMB SMB + beta_HML HML + beta_RMW RMW + beta_CMA CMA + beta_MOM MOM + epsilon
```

- NVII は線形株式ファクターだけでは説明が足りない可能性が高い。そのため追加で以下を検証する:
  - VIX または volatility factor
  - IV − realized volatility
  - variance risk premium proxy
- 目的: オプション売り由来の収益を alpha と誤認していないかを確認する。
- IV データの正本は実装前に決める（**UNVERIFIED**: 利用可能なソースは未確認）。IV が取得できない場合は、その旨を動画・レポートに明記し、該当項目を「未検証」とする。

### 3.6 Robustness

- 開始日をずらした再計算。
- rolling 63 / 126 / 252 営業日の alpha。
- 週次集計での再確認。
- FF3 / FF5 / FF5+MOM / NVDA-control の横並び比較。
- look-ahead 禁止（各時点の推定は、その時点までの情報のみを使う）。

### 3.7 alpha の区分

- 「alpha 候補」: 点推定で正の alpha。
- 「統計的に有意な alpha」: Newey-West 標準誤差で有意水準を満たすもの。
- 両者は必ず区別して表示する。

## 4. 必須チャート（10 項目、最低 8 枚を自動生成）

| # | チャート | 入力 |
|---|---|---|
| 1 | Growth of $10,000（NVII / NVDA / NVDY / QQQ / VT） | 日次 Total Return |
| 2 | Drawdown（同一期間） | 日次 Total Return |
| 3 | Risk-return scatter（x: 年率 vol、y: 年率 return） | 3.3 の統計 |
| 4 | Efficient frontier（単体 ETF 点を含む） | 3.4 の結果 |
| 5 | Correlation heatmap | 3.3 の相関行列 |
| 6 | Alpha comparison（CAPM / FF5 / FF5+MOM / NVDA control / NVDA+FF5+MOM） | 3.5 の回帰結果 |
| 7 | Factor loading（MKT / SMB / HML / RMW / CMA / MOM） | 3.5 の回帰結果 |
| 8 | Rolling alpha | 3.6 の rolling 結果 |
| 9 | 原資産別カバコ適性マップ（MSFT / AMZN / AAPL / TSLA / MSTR / NVDA / AMD / PLTR / COIN） | 原資産の指標（5.2 参照） |
| 10 | NVII return decomposition（NVDA exposure / option income / upside sacrificed / costs / residual） | 6 章の分解結果 |

- チャートは分析 script が機械生成する。手描き・手打ちの数値は使わない。
- 配色・レイアウトは dataviz の方針に従う（実装時に確認）。

## 5. 分析の解釈と原資産別カバコ適性

### 5.1 NVII の位置づけ

NVII は「高配当 ETF」ではなく、「NVDA をレバレッジ＋部分カバーで加工した商品」として扱う。商品仕様は REX の公表値で確認する。

### 5.2 カバコ適性の判断軸

「高 IV ほどカバコ向き」は採用しない。以下を見る:
- expected drift
- realized volatility
- implied volatility
- IV − RV
- positive skew
- jump frequency
- upside trend persistence

定性的な例（Issue 記載、検証前の仮説）:
- MSFT / AMZN: 全面カバーでも原資産リターンを比較的残しやすい
- NVDA / AMD / PLTR: 右側テールが大きく、全面カバーでは機会損失が大きくなりやすい

IV や skew の時系列データ源は未確定（**UNVERIFIED**）。取得できない項目は空欄ではなく「未検証」と表示する。

### 5.3 リターン分解（概念式）

```
R_NVII ≈ λ R_NVDA + option premium − call upside loss − financing cost − fee − volatility drag
```

- 各項を推定できる範囲で数値化し、残差（residual）として明示する。
- 推定できない項目は推定値を作らず、「未推定」とする。

## 6. 結論の出し方

断定しない。以下を分けて提示する:
1. 観測された超過リターン
2. factor exposure で説明できる部分
3. option premium で説明できる部分
4. 統計的に残る alpha（有意性とともに）
5. 推定誤差（期間長、標準誤差、データ源の差）

## 7. 完成時に答える問い（動画・レポートの対応表）

| # | 問い | 対応する分析 |
|---|---|---|
| 1 | NVII の NVDA 超過は、どこまで追加 beta で説明できるか | 3.5 の CAPM / FF5 / NVDA-control の比較 |
| 2 | FF5+Momentum 後にも alpha は残るか | 3.5 の FF5+MOM |
| 3 | NVDA を control しても alpha は残るか | 3.5 の NVDA-control / NVDA+FF5+MOM |
| 4 | その alpha は統計的に有意か | Newey-West の t-stat / p-value |
| 5 | NVDY と NVII では、どちらが efficient frontier を押し上げたか | 3.4 のフロンティア（単体点・組み合わせ） |
| 6 | 「高 IV 原資産ほどカバコ向き」は本当か | 5.2 の指標と 4 章の 9 番チャート |
| 7 | NVDA では全面カバーより部分カバーの方が合理的だったか | 5.3 の分解（ケース比較は別途定義が必要。UNVERIFIED） |
| 8 | この結果は開始日をずらしても残るか | 3.6 の robustness |

## 8. 動画構成と台本（7〜9 分）

Issue の構成（Hook / Total Return / 分解 / フロンティア / FF alpha / カバコ適性 / 結論）を踏襲する。

- 台本は計算済みの JSON / CSV のみ参照する。数値の手打ち禁止。
- 数値を変えたときに台本が追従できるよう、台本の数値は analysis output の key で指定する。
- 台本の長さは 7〜9 分の範囲に収める（話速ベースの見積もりは実装時に確認）。

## 9. サムネイル

- メイン文言: 「配当40%」の正体
- 小見出し: NVII > NVDA？
- ビジュアル: NVII +80.7% / NVDA +67.0%（数値は分析出力から取る）、「alpha？」、efficient frontier 曲線、Fama-French 式
- 別案「NVDA現物、要らない？」は断定を避け、期間依存性・推定誤差を本編で明示する。
- サムネイル 1 枚を生成する。

## 10. 実装計画

### 10.1 成果物

- canonical dataset（日次 Total Return）
- analysis output（統計・フロンティア・回帰結果、CSV/JSON）
- chart artifacts（8 枚以上、機械生成）
- manifest（source URL、retrieved_at、期間、formula version、差分）
- 動画台本、サムネイル、description（primary source URL を記録）
- 再実行可能な task / CLI

### 10.2 フェーズ

1. Research: 一次資料の取得・snapshot 保存、manifest の作成
2. Dataset: Total Return 系列の構築、Total Real Returns との差分確認
3. Analysis: 基本統計、相関、フロンティア、回帰（5 モデル）、robustness
4. Decomposition: NVII の分解、IV 系ファクターの検証
5. Output: チャート生成、台本・サムネ・description の生成
6. Verification: 数値の trace 確認、再生成時の数値差分チェック

### 10.3 再生成と差分

- 再生成時に数値差分が出たら fail または review 対象にする。
- 差分の閾値は実装時に決める（UNVERIFIED）。

### 10.4 ファイル所有（並列化時の分担案）

同一ファイルを複数 agent に編集させない。分担の単位:
- データ取得・canonical dataset
- 分析（統計・フロンティア・回帰）
- チャート生成
- 台本・サムネ・description
- manifest と検証

ディレクトリ配置は既存の yt3 の構成規則（`AGENTS.md` と `docs/standard/repository-layout-standard.md`）に従い、ルート直下にファイルを作らない。

## 11. Acceptance Criteria との対応

| Acceptance Criteria | 対応節 |
|---|---|
| NVII / NVDA / NVDY / QQQ / VT の日次 Total Return を共通期間で再現 | 2.2, 3.1 |
| Total Real Returns 表示値との誤差を説明 | 3.2 |
| 年率 return / vol / Sharpe / Sortino / MaxDD を出力 | 3.3 |
| correlation matrix を出力 | 3.3, 4 章 5 番 |
| long-only efficient frontier を再現可能に計算 | 3.4 |
| CAPM / FF5 / FF5+MOM / NVDA-control / NVDA+FF5+MOM を実行 | 3.5 |
| alpha の年率値に加え t-stat / p-value / R² を表示 | 3.5 |
| Newey-West 標準誤差を使用 | 3.5 |
| 「alpha 候補」と「統計的に有意な alpha」を区別 | 3.7 |
| 高分配率を Total Return と混同しない | 1, 2.2（分配は Total Return の一部としてのみ扱う） |
| 少なくとも 8 枚の分析チャートを自動生成 | 4 章 |
| サムネイル 1 枚を生成 | 9 |
| 7〜9 分の動画台本を生成 | 8 |
| 全数値が canonical dataset / analysis output へ trace できる | 2.3, 8, 10.1 |
| primary source URL を description に記録 | 2.1, 10.1 |
| 再実行可能な task / CLI を用意 | 10.1 |

## 12. リスクと残件

| 項目 | 内容 | 対応 |
|---|---|---|
| 標本期間が短い（約 1.3 年） | alpha の検出力が低く、有意性が出にくい | 有意性と推定誤差を必ず併記。結論を断定しない |
| NVII の運用開始が 2025-05-28 | それ以前の NVII 挙動は分析できない | 期間限定の結論として明示 |
| FF factor はオプション収益を含まない | 線形株式ファクターでは option premium を捉えられない | IV 系ファクターを追加（3.5） |
| NVDA-control の内生性 | NVII が NVDA を含むため、control は beta の推定を歪める可能性 | 結果の解釈に注意を付け、control なしの結果と併記 |
| 多重比較 | 複数モデル・複数期間の比較で偶然の有意が出やすい | 有意結果は robustness で確認し、単独の p 値で断定しない |
| IV データの入手性 | 正本が未確定（UNVERIFIED） | 未取得項目は「未検証」と表示 |
| Total Real Returns との差 | 配当の扱いや価格ソースで差が出る可能性 | 差分を一覧化し、自前再構築を正本とする |
| 開始日依存 | 開始日により結論が変わる可能性 | 3.6 の robustness で確認 |
| 週次・rolling の窓幅 | 窓の選択で結果が変わる | 63 / 126 / 252 を事前に固定 |

## 13. 次のアクション

1. Issue 記載の一次資料 URL の取得可否と内容を確認する（UNVERIFIED のまま残っている項目）。
2. 日次価格・分配の正本を 1 本選定し、manifest 形式を決める。
3. IV 系データの入手可能性を確認し、3.5 の追加検証の範囲を決める。
4. 2〜3 フェーズの実装を開始する（10.2）。
