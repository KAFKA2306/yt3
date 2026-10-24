# Issue #187 企画計画: 2027年メモリ業界の二極化解説

対象: GitHub Issue #187「【動画企画】2027年メモリは全部下がる？ HBM・DRAM高騰、NAND二極化を需給で解説」
関連: #186 AIメモリ階層（HBM / HBF / 高帯域Flash / SSD）、#130 メモリETF / 半導体ETF比較

## 0. 注意事項

- 本ドキュメントは企画・構成の設計のみ。価格・需給の数値は一切含めない。
- 数値はすべて **UNVERIFIED**。制作runで一次資料から再取得し、`source_date` と `actual_or_forecast` を付与する。
- 今回は WebSearch を実行していない（Issue が「制作時の最新データで決める」と指定しているため）。
- 投資推奨にはしない。業界構造の解説として完結させる。

## 1. 中心仮説

「メモリ全部暴落」「NAND増産だからサーバー屋が丸儲け」の一括りを避け、次の二極化を検証する。

```
GPUに近いほど不足しやすい
HBM > Server DRAM > Enterprise SSD / QLC > Consumer NAND > HDD
```

| 層 | 仮説 | 判定 |
|---|---|---|
| H1 HBM | 最もタイト | UNVERIFIED |
| H2 Server DRAM | HBMのwafer消費で圧迫 | UNVERIFIED |
| H3 Enterprise SSD | Consumer NANDと分離して強い | UNVERIFIED |
| H4 Consumer NAND | 最も緩みやすい | UNVERIFIED |
| H5 Nearline HDD | 2027〜28年の監視対象 | UNVERIFIED |

反証も同じ粒度で用意する（H1: blended ASP上昇を同一製品の値上げと誤読していないか / H5: 東芝増産をAI需要が吸収するか）。

## 2. Working title と Core message

- Working title: 「2027年、メモリは全部下がる？ HBM・DRAM・NANDで真逆になる理由」
- 候補3案（Issue記載のもの）から、制作時に最終決定する。
- Core message: 2027年はメモリ業界全体の暴落ではなく、AI向け高付加価値メモリと汎用品の価格差が広がる可能性がある。
- Done文（視聴者が言えれば完了）: 「HBM、DRAM、NAND、SSD、HDDは全部同じサイクルではない。AI需要が強いほどGPUに近いメモリは不足しやすく、汎用品は供給増で緩みやすい。」

## 3. 主要ビジュアル

1. GPUからの距離図（縦1枚）: GPU → HBM → Server DRAM → Enterprise SSD → Consumer NAND → HDD。DRAM vs NAND の分類より先に出す。
2. 2026Q4=100 価格指数チャート: Base / Bull / Bear の3ケース。数値はすべて制作時再取得。過去の仮置き値は使わない。
3. 企業地図: HBM/DRAM（Micron, SK hynix, Samsung）、NAND/Enterprise SSD（Kioxia, SanDisk, Micron, Samsung）、HDD（WDC, Seagate, Toshiba）。各社の利益感応度・供給能力・CapEx・長期契約を表示。

価格指数の表は Issue 記載の形（Layer / 2026Q4 / 2027 Base / 方向）を踏襲し、値は全部 `TBD`。

## 4. 尺とナレーション構成（本編 7〜10分台）

| 時刻 | 内容 |
|---|---|
| 0:00 | Hook: 「メモリ価格が下がるらしい」。HBM/DRAM/NAND/SSD/HDDを1画面に出す |
| 0:30 | 用語整理: HBM = GPU横 / DRAM = 作業場所 / SSD = 大容量の高速倉庫 / HDD = さらに大きな倉庫 |
| 1:30 | HBM: AI計算能力の増加に供給が追いつくか |
| 2:30 | Server DRAM: HBMへのwafer allocationの影響 |
| 3:30 | Enterprise SSD: 推論時代に「保存」からメモリ階層の一部へ上がる仮説 |
| 4:30 | Consumer NAND: DC需要とPC/スマホ需要を混ぜない |
| 5:30 | HDD: 東芝増産を紹介。「増産→即暴落」にしない。吸収される反証も提示 |
| 6:30 | 企業別: 7社をメモリ種類別の感応度で並べる |
| 7:30 | 2028年: 新Fab・新設備の本格寄与。本当のサイクル転換は2027ではなく2028の可能性 |
| End | 「メモリ高い／安い」ではなく「どのメモリが足りないのか」を見る |

ずんだもん／つむぎの掛け合いはHookと要所に入れる。キャラクター設定は既存の制作ルールに従う。

## 5. 必要な成果物（Deliverables）

- [ ] 初心者向け本編台本（7〜10分台）
- [ ] HBM / DRAM / Enterprise SSD / Consumer NAND / HDD の需給表
- [ ] 2026Q4=100 価格指数チャート（Base / Bull / Bear）
- [ ] GPUからの距離で見る記憶階層図
- [ ] 主要7社の企業マップ
- [ ] 2027 / 2028 供給能力ロードマップ
- [ ] 概要欄用一次ソース一覧
- [ ] サムネ3案
- [ ] 30〜45秒 Shorts 版
- [ ] factual QA 記録

## 6. データ要件

### 6.1 各数値に保持する項目

```
metric / value / unit / period / product / source / source_date / actual_or_forecast
```

### 6.2 一次ソース候補（制作runで最新版を確認）

- 企業IR・Newsroom: Micron IR、SK hynix Newsroom/IR、Samsung Semiconductor/IR、Kioxia Holdings IR、SanDisk IR、Western Digital IR、Seagate IR、Toshiba HDD/Storage 公式
- 市場データ: TrendForce（予測値として扱う）。Omdia / Counterpoint は補助
- URLは未確認のため本文に記載しない（UNVERIFIED）

### 6.3 H1〜H5 ごとの見る数字

- H1 HBM: HBM bit demand、wafer allocation、HBM4/HBM4E qualification、blended ASPと同一世代ASPの分離
- H2 Server DRAM: DRAM bit supply growth、Server DRAM demand growth、DDR5/MRDIMM価格、CapEx
- H3 Enterprise SSD: Enterprise SSD ASP、QLC比率、DC NAND bit demand、DC向け売上・LTA、GPU Direct Storage / CXL との接続
- H4 Consumer NAND: Client SSD / UFS / mobile NAND価格、NAND bit supply growth、稼働率、新Fab立ち上がり
- H5 HDD: Nearline $/TB、EB shipment、WDC/STX gross margin、Toshiba capacity ramp、LTA価格

## 7. ファクトチェック規則（公開前に全項目 PASS）

- [ ] HBM blended ASP と same-generation ASP を分離した
- [ ] DRAM と NAND を同じ価格指数として扱っていない
- [ ] Consumer NAND と Enterprise SSD を分離した
- [ ] bit growth と売上 growth を混同していない
- [ ] GB / GiB、Gb / GB を区別した
- [ ] HDD の $/TB と drive ASP を区別した
- [ ] 製品価格・契約価格・スポット価格を区別した
- [ ] TrendForce 等の予測は「予測」と表示した
- [ ] メーカー自身の需給見通しは「会社側見解」と表示した
- [ ] 2027年予測は制作時点で再取得し、公開日・対象製品・期間を保存した
- [ ] 「メモリ全体が暴落」と断定していない
- [ ] 「HBMが2倍」等の blended ASP を誤訳していない
- [ ] 東芝増産を「価格暴落確定」と扱っていない

## 8. 受け入れ基準（Acceptance criteria）との対応

| 受け入れ基準 | 対応する節 | 状態 |
|---|---|---|
| 「メモリ全部」を分解できている | 1, 4 | 企画済 |
| 5層を別需給として説明 | 1, 3, 6.3 | 企画済 |
| 2027年の方向を最新データで再検証 | 3, 6 | 制作時作業 |
| 2028年の新Fab立ち上がりを確認 | 4 (7:30), 6 | 制作時作業 |
| 各価格予測に source date を付与 | 6.1 | 制作時作業 |
| 主要7社の利益感応度を整理 | 3, 4 (6:30) | 制作時作業 |
| 東芝増産を暴落確定と扱わない | 4 (5:30), 7 | 企画済 |
| 強気と反証の両方を提示 | 1, 4 | 企画済 |
| 本編のみで中心仮説が理解できる | 2 (Done文), 4 | 台本時に確認 |
| 投資推奨ではなく構造解説で完結 | 0 | 企画済 |
| factuality/source-policy QA PASS | 7 | 制作時作業 |
| yt3 canonical pipeline から再生成可能 | 本ドキュメントでは未確認 | UNVERIFIED |

## 9. 未完了・未確認

- 2026Q4 の基準値、2027 Base/Bull/Bear の数値: 未取得（UNVERIFIED）。制作runで取得する。
- 各社の最新IR数値、TrendForce の最新予測: 未取得（UNVERIFIED）。
- 「yt3 canonical pipeline から再生成可能」: 既存パイプラインの入口（Taskfile の対応タスク）をこの計画では確認していない（UNVERIFIED）。
- #186 / #130 との内容重複の整理: 未確認。
