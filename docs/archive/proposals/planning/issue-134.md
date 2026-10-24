# Issue #134 企画・検証計画: 光スイッチ半導体（AIデータセンターの次のボトルネック）

対象: GitHub Issue #134「光スイッチ半導体：AIデータセンターの次のボトルネックを業界地図で追う」
性質: 企画ラフと検証計画。投資推奨ではない。記載の企業・数値はすべて一次資料で再確認するまで事実として扱わない。

## 1. 結論（先に述べる）

- 動画の主張は「AIクラスタの拡大で、計算だけでなく通信路（帯域・遅延・消費電力）が次の制約になり、価値は光の経路を握る層に移る可能性がある」に絞る。
- 「光関連株が伸びる」とは言わない。CapEx → capacity → product → revenue → EPS → forward PER の連鎖を、企業ごとに一次資料で確認できた範囲だけ示す。
- 現時点で確認済みの事実はない。以下の企業名・技術分類はすべて **UNVERIFIED**（Issue 本文の候補リスト由来）。

## 2. 用語の区別（Acceptance 1）

| 用語 | 定義（一般的な理解） | 動画での扱い |
|---|---|---|
| packet switch | 宛先ごとにパケットを解析して転送するスイッチ（Ethernet スイッチ等） | 現行 AI ネットワークの主役。電気信号で処理 |
| optical circuit switch (OCS) | 光信号を経路ごと切り替える。パケットの中身は解析しない | 「光スイッチ」の主題。MEMS 方式などがある |
| optical transceiver / module | 電気信号と光信号を相互変換する部品（800G/1.6T 等） | スイッチの「隣」にあり、別の市場。混同しない |
| silicon photonics (SiPh) | シリコン基板上に光回路を作る技術 | 方式名。製品か部品かを区別して扱う |
| MEMS optical switch | 微小な鏡を動かして光路を変える方式 | OCS の一方式。UNVERIFIED: 採用事例は一次資料で確認 |
| LiNbO3 (ニオブ酸リチウム) | 高速変調に使われる材料 | 材料・デバイス層。チップ企業とは別に分類 |

確認事項: 「光スイッチ」を packet switch や transceiver と同一視しない。動画のナレーションで毎回区別を示す。

## 3. 動画構成（8〜12分）

| 章 | 尺目安 | 内容 | 根拠の種類 |
|---|---|---|---|
| 0. Hook | 0:00-0:30 | 「GPUの次に足りなくなるのは、GPUではない。」 | 主張（検証対象） |
| 1. AIクラスタ巨大化 | 0:30-2:00 | GPU 増加、east-west トラフィック、400G→800G→1.6T | 要一次資料（CapEx/製品ロードマップ） |
| 2. 電気配線の限界 | 2:00-3:30 | 帯域・遅延・消費電力。光化がラック外→ラック内→パッケージ近傍へ進む仮説 | 仮説として提示。技術資料で裏付け |
| 3. 光スイッチは何を切るか | 3:30-5:00 | packet switch との違い、OCS / MEMS / SiPh の整理 | 技術一般論（出典を付す） |
| 4. 業界地図 | 5:00-7:00 | system → module → optical switch 半導体 → materials/equipment | 企業分類（一次資料で確定） |
| 5. 企業別比較 | 7:00-9:30 | 製品・顧客・CapEx/能力・業績の接続 | 一次資料のみ |
| 6. 投資仮説の検証 | 9:30-11:00 | 「AI需要増 ≠ 全光関連株増」。連鎖を追う | 数値は出典と基準年を明記 |
| 7. 結論と残る問い | 11:00-11:30 | 価値源泉とボトルネックの比較で締める | 投資推奨にしない |

## 4. 企業比較の対象と検証手順（Acceptance 2・3）

Issue の候補（すべて UNVERIFIED）:

- システム/スイッチ: Broadcom, Marvell, NVIDIA, Intel, Cisco, Arista
- 光モジュール/光部品: Coherent, Lumentum, POET Technologies
- 日本勢: NTT, Fujitsu, Sony, Sumitomo Electric

検証手順（企業ごと）:

1. 一次資料（決算資料・10-K/有報・公式製品ページ）で「光スイッチ半導体」を製造しているかを確認する。
2. 分類を一つに決める: システム / モジュール / チップ / 材料・装置。複数該当は主要事業で決める。
3. 顧客: hyperscaler との契約・採用が一次資料にあるかを確認する。無ければ「未確認」と書く。
4. 能力・CapEx: 公表済みの設備投資・生産能力のみ。推定は使わない。
5. 業績: revenue / EPS は決算資料の値。forward PER は計算日と株価の出典を明記する（UNVERIFIED のまま載せない）。
6. 目標: 少なくとも 10 社で 1〜5 を満たす。満たせない企業は「未確認」として比較表に残す。

## 5. Semiconductor CapEx Decision DB との同期（Acceptance 5）

Issue 指定のテーブルと、本計画で必要とする項目:

| テーブル | 追加・更新する内容 | 必須列 |
|---|---|---|
| Products_SupplyChain | optical switch / silicon photonics / MEMS / optical I/O の区分 | 企業, 分類, 製品名, source_url |
| CapEx_Events | fab / packaging / optical capacity 投資 | 企業, 金額, 基準年, source_url |
| Capacity_Metrics | wafer / module / transceiver / packaging の能力 | 単位, 値, 基準年, source_url |
| Demand_Commitments | hyperscaler / network vendor の契約・採用 | 相手先, 内容, 日付, source_url |
| Financials / Estimates_Valuation | revenue / EPS / forward PER | 基準日, 値, 種別（実績/推定）, source_url |
| Sources | 全行の出典 | source_url, publication_date, retrieved_at, status |

ルール:
- 実績値と推定値は列で区別し、混ぜない。
- 全数値は `source_url` と `retrieved_at` を持つ。出典のない行は `status = unverified` とし、動画では使わない。
- DB を正本とし、動画の数値は DB から生成する（手入力の二重管理を作らない）。
- DB の既存スキーマは実装前に確認する（本ドキュメントでは未確認）。

## 6. 市場規模・CAGR（Acceptance 4）

- 市場規模と CAGR は、出典・調査機関・基準年・対象範囲（光スイッチのみか、光通信全体か）を必ず併記する。
- 出典の異なる数値を比べて伸び率を作らない。
- 現時点の市場規模数値: UNVERIFIED（未取得）。

## 7. 日本企業の露出

- NTT, Fujitsu, Sony, Sumitomo Electric について、直接（光スイッチ/部品を製造）か間接（材料・装置・顧客）かを一次資料で分類する。
- 確認できない露出は「未確認」と書く。推測で「関連あり」と書かない。

## 8. 成果物チェックリスト

- [ ] 8〜12 分の動画構成（第3章）
- [ ] 業界地図 1 枚（第4章。draw.io 等の既存図解ツールで作成）
- [ ] supply-chain 図 1 枚
- [ ] 因果図「AI → network bottleneck → optical switching」1 枚
- [ ] 主要企業比較表（第4章の手順で作成）
- [ ] 一次資料リンク集（DB の Sources 行から生成）
- [ ] narration / subtitle
- [ ] thumbnail 案（Hook の一文を使う）

## 9. Acceptance Criteria との対応

| 基準 | 本計画での対応 | 状態 |
|---|---|---|
| 光スイッチ/packet switch/transceiver の区別 | 第2章 | 計画済み |
| 主要企業を一次資料で分類 | 第4章 手順 1-2 | 未実施 |
| 少なくとも10社で製品・顧客・CapEx・業績を接続 | 第4章 手順 3-6 | 未実施 |
| 市場規模/CAGR に出典と基準年 | 第6章 | 未実施 |
| CapEx DB と数値を同期 | 第5章 | 未実施（DB 構造は未確認） |
| 投資推奨ではなく比較動画 | 第1章・第3章第7節 | 方針として確定 |

## 10. 未確認・残件（UNVERIFIED）

1. Issue 記載の全企業の製品分類（一次資料での確認が必要）。
2. 光スイッチ市場の規模と CAGR（出典未取得）。
3. hyperscaler との契約・採用の事実（未確認）。
4. forward PER の算出日と株価（未取得）。
5. Semiconductor CapEx Decision DB の現行スキーマ（本計画では読んでいない）。
6. 日本企業 4 社の露出分類（未確認）。
7. MEMS 方式の採用事例（一次資料未確認）。

本ファイルは計画のみで、DB・データ・動画の生成は行っていない。
