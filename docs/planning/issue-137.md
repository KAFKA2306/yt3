# Issue #137 企画・制作計画: AIデータセンター成長市場マップ

対象: GitHub Issue #137 `[Video Idea] GPUの次に伸びるのはどこ？ AIデータセンター各分野の成長率マップ`

本書は企画・台本・検証計画である。投資推奨ではない。数値はすべて Issue 記載値であり、一次出典での再確認は未実施。未確認の数値は `UNVERIFIED` と表記する。

## 1. 動画の核

- 主題: GPU性能向上が、HBM、通信、光、パッケージ、電源/冷却のどこで売上を増やすかを説明する。
- 連鎖: `AI GPU → HBM → Scale-up interconnect → Switch/NIC/DPU → Optics/SiPh/CPO → Storage` と、横串の `Foundry / Advanced Packaging / Power / Cooling / Rack / Fiber`。
- 評価軸: 市場規模、CAGR、2026年単年YoY、GPU増設との連動性、価格サイクル依存度、立ち上がり初期か既存巨大市場か。単純な成長率ランキングにはしない。

## 2. 作品タイトル候補（5本）

1. GPUより伸びる市場がある？ AIデータセンター「次の成長分野」を全部並べる
2. AIデータセンターで本当に伸びるのはどこ？ GPU・HBM・光・液冷を比較
3. GPUを買うたび、誰の売上が増える？ AIインフラ成長率マップ
4. CPO 230%・AIネットワーク40%級？ AIデータセンター成長産業を分解
5. GPUの次のボトルネックはどこ？ HBM・通信・光・電力を1本の連鎖で解説

採用候補はタイトル1。CTR検証用に2と4を予備とする。「230%」は基準額が小さいことを本文で必ず説明する前提で、タイトルに使うかは要確認。

## 3. サムネ案（3案）

- A: 「GPU → HBM → 通信 → 光 → 電力/冷却」の矢印図。中央に「GPUの次は？」。
- B: 数字を大きく置く。「CPO 230%」に小さく「基準額は小さい」と併記。CAGRと明記。
- C: GPUチップを背景に、周辺部品（HBM、光モジュール、冷却配管）を前景に配置。見出しは「GPUを買うと誰が儲かる？」。

サムネ上の数字は必ず「CAGR」か「YoY」を併記する。

## 4. 構成台本（6〜8分）

| 時間 | 章 | 内容 | 主図 |
|---|---|---|---|
| 0:00–0:25 | Hook | 「AI半導体で伸びる会社 = NVIDIA」だけでは地図の半分。GPUを1個増やすと、HBM、スイッチ、光、パッケージ、電源、冷却にも需要が発生する。 | 図1 |
| 0:25–1:30 | GPUは需要の起点 | AI GPU / custom accelerator の構造成長(26.8% CAGR, 〜2030, UNVERIFIED)を確認。ただし主役はGPU増設による二次需要。 | 図2 |
| 1:30–2:30 | 最初のボトルネックはHBM | GPU性能向上にはデータ供給能力が必要。HBMはDRAMの一種であり、通常DRAMとは別の技術階層。2026年の需要量は +70%以上(UNVERIFIED、需要量であり売上ではない)。 | 図3 |
| 2:30–4:00 | 次のボトルネックは通信 | Scale-up と Scale-out を分ける。NVLink / UALink / PCIe / CXL、Switch ASIC、NIC/DPU、Retimer/SerDes。AIネットワークが高成長になる理由を「GPU台数 × GPU間通信量」で説明。 | 図1 |
| 4:00–5:30 | 光がGPUへ近づく | 従来 `Switch → 基板上電気配線 → Pluggable Optics → Fiber`、進行中 `Switch ASIC → CPO → Fiber`、将来 `XPU → Optical I/O → Fiber`。CPO/NPOの高CAGRは巨大市場だからではなく、ほぼゼロから立ち上がるためと明示。 | 図4 |
| 5:30–6:30 | 電力と熱 | GPU・HBM・ネットワークを増やすほどラック電力密度と発熱が増える。液冷、電源分配、Busway、Rackは半導体需要の外側で成長する。 | 図1 |
| 6:30–7:00 | 結論 | 見るべき指標は「成長率1位」ではなく `市場規模 × 成長率 × シェア × 利益率 × GPU需要との連動性`。次回導線。 | — |

## 5. 主要図（4枚）

1. **AIデータセンター全体像**: 横方向に `GPU → HBM → Scale-up → Switch/NIC/DPU → Optics/CPO → SSD`。下段に `Foundry / Advanced Packaging / Power / Cooling / Rack / Fiber` の横串。
2. **構造成長率(CAGR)**: CAGRのみの横棒グラフ。期間と基準額を各バーのラベルに入れる。CPOは「基準額小」の注記付き。CPUはAI専用市場と分けて別枠。
3. **2026年単年YoY**: DRAM / NAND / HBM / Foundry を別カードで表示。HBMは「需要量」、他は「売上」と明記。NAND +371.9%、DRAM +246.6% は価格・供給サイクル注記付き。
4. **光の接近**: Pluggable optics → CPO → Optical I/O の3段階。

CAGRと単年YoYを同じ棒グラフに混ぜない。

## 6. エビデンス台帳（evidence ledger）

列: 数値 / 単位 / 種別(CAGR or YoY or 需要量) / 対象期間 / 出典 / 発表日 / 市場定義 / 検証状態

| # | 分野 | 数値 | 種別 | 対象期間 | 出典(Issue記載) | 発表日 | 市場定義 | 状態 |
|---|---|---|---|---|---|---|---|---|
| 1 | CPO / NPO | 約230% | CAGR | 2025–2030 | TrendForce | 2026-06-15 (URL日付) | 極小市場からの立ち上がり | UNVERIFIED |
| 2 | 光トランシーバー | 約41%/年 | 成長率 | 2024–2026 | LightCounting(推定) | 要確認 | AIクラスタ向け | UNVERIFIED |
| 3 | AIネットワーク | 40%以上 | CAGR | 2024–2029 | Dell'Oro | 要確認 | front-end / back-end / scale-up を区別 | UNVERIFIED |
| 4 | Direct Liquid Cooling | 約39% | CAGR | 2024–2029 | 要確認 | 要確認 | 液冷 | UNVERIFIED |
| 5 | AI GPU / accelerator | 26.8% | CAGR | 〜2030 | Gartner(推定) | 要確認 | GPU + custom accelerator | UNVERIFIED |
| 6 | 高性能先端パッケージ | 約23% | CAGR | 2024–2030 | 要確認 | 要確認 | HBM / 2.5D / 3D | UNVERIFIED |
| 7 | DC電源・冷却・ラック | 22% | CAGR | 2025–2030 | Dell'Oro | 要確認 | physical infrastructure | UNVERIFIED |
| 8 | Data Center SSD | 17.4% | CAGR | 2026–2033 | 要確認 | 要確認 | enterprise / DC SSD | UNVERIFIED |
| 9 | CPU | 約7–11% | CAGR | 〜2033/35 | 要確認 | 要確認 | AI専用市場とは分ける | UNVERIFIED |
| 10 | NAND売上 | +371.9% | YoY | 2026 | Gartner(推定) | 2026-08-24 (URL日付) | 売上・価格/供給サイクル影響大 | UNVERIFIED |
| 11 | DRAM売上 | +246.6% | YoY | 2026 | Gartner(推定) | 2026-08-24 (URL日付) | 売上・価格/供給サイクル影響大 | UNVERIFIED |
| 12 | HBM需要量 | +70%以上 | 需要量 | 2026 | TrendForce | 2025-10-30 (URL日付) | 需要量であり売上ではない | UNVERIFIED |
| 13 | Foundry売上 | +18.8% | YoY | 2026 | Gartner(推定) | 2026-08-24 (URL日付) | 市場全体 | UNVERIFIED |

- 「出典」「発表日」の(推定)は、Issueのソース候補URLから推定した値で、本文には使わない。
- 検証が完了するまで動画内の数値は「予測」「推計」として表示する。

## 7. 出典候補（概要欄用）

- Gartner: AI processing semiconductor forecast — https://www.gartner.com/en/documents/8259357
- Gartner: 2026 semiconductor revenue / DRAM / NAND — https://www.gartner.com/en/newsroom/press-releases/2026-08-24-gartner-forecasts-worldwide-semiconductor-revenue-to-reach-1-trillion-dollars-in-2026
- TrendForce: HBM demand — https://www.trendforce.com/presscenter/news/20251030-12762.html
- Dell'Oro: AI networking — https://www.delloro.com/news/ai-back-end-switch-sales-to-approach-1-trillion-over-the-next-five-years/
- Dell'Oro: data center physical infrastructure — https://www.delloro.com/news/data-center-physical-infrastructure-market-forecast-to-reach-120-billion-by-2030/
- LightCounting: optics for AI clusters — https://www.lightcounting.com/newsletter/en/january-2025-optics-for-ai-clusters-319
- TrendForce: CPO / NPO — https://www.trendforce.com/presscenter/news/20260615-13098.html

概要欄には各URLの発表主体・発表日・対象期間を併記する。

## 8. Shorts 用台本（30〜45秒）

タイトル: 「GPUを買うと誰が儲かる？」

1. (0–5秒) GPUを1個買うと、それだけでは動かない。
2. (5–15秒) HBMで データを供給し、スイッチとケーブル・光部品でGPU同士をつなぎ、電源と冷却で熱を逃がす。
3. (15–30秒) 伸びている周辺市場は、CPO/光、先端パッケージ、液冷、電源・ラック。
4. (30–40秒) ただし成長率は市場規模と基準額で大きく変わる。数字は必ず出典と期間を確認。
5. (40–45秒) 次回は「この成長市場の利益が誰に落ちるか」を解説。

## 9. 次回への導線

次回タイトル案: 「この成長市場の利益は、Broadcom / Marvell / Astera Labs / Coherent / Lumentum / Micron / SK hynix / TSMC の誰に落ちるのか」

企業名は本動画では扱わない。個別企業の利益予測・株価示唆は含めない。

## 10. 受け入れ基準の確認状況

| 基準 | 計画上の担保 | 状態 |
|---|---|---|
| CAGRと単年YoYが画面上で分離 | 図2と図3を別図にする | 制作時に確認 |
| HBMをDRAMの一種として説明 | 台本1:30–2:30 | 台本済 |
| Scale-up / Scale-out / Optics の位置関係が1枚で分かる | 図1 | 制作時に確認 |
| 主要数値にsourceと期間 | 台帳13件 | 未検証 (UNVERIFIED) |
| CPOの低い初期市場規模を明示 | 台本4:00–5:30、図2の注記 | 台本済 |
| 市場成長率を株価上昇予測として表現しない | 台本全体で禁止。概要欄にも注記 | 台本済 |
| 動画だけで「GPU → HBM → 通信 → 光 → 電源/冷却」を説明できる | 台本の章順 | 視聴テストが必要 |

## 11. 未完了・残件

- 数値13件の一次出典確認: Web検索および各URLの原典確認が未実施。`UNVERIFIED` のまま。Issue記載の成長率や発表日は、この文書では事実として扱わない。
- 出典URLの到達性確認: 未実施。
- 市場調査会社間で市場定義が異なるため、CAGRを厳密な順位として扱わない。
- 図の制作、サムネ画像の制作、Shorts動画の制作: 本書の対象外。
- 台本の読み上げ時間計測: 未実施。
