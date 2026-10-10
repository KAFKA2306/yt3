# Issue #135 企画計画: GPUの次は「光」だった（シリコンフォトニクス / CPO）

対象: yt3 / 秒算マネー（`byosan`）
Issue: https://github.com/KAFKA2306/yt3/issues/135 （GitHub 上の正式 URL は `gh issue view 135` で確認）
状態: 計画書のみ。動画・script・media は未作成。

凡例: `VERIFIED` = 一次情報で確認済み / `CLAIM` = 企業発表の数値・主張（独立検証なし） / `UNVERIFIED` = 未確認

---

## 1. 動画の主張（1文）

AIデータセンターで GPU の次に詰まるのは通信と電力であり、配線が電気から光へ移っている。
これは「新技術紹介」ではなく産業構造の変化として扱う。

## 2. 30秒説明（完成条件 1）

シリコンフォトニクスは、レーザー光の変調・導波路・受光をシリコン基板上の半導体製造技術で作る方式。
GPU 同士をつなぐ電気信号を、ASIC のすぐ近くで光信号に変換することで、距離あたりの損失と電力を下げる。
CPO（Co-Packaged Optics）は、この光エンジンをスイッチ ASIC と同じパッケージに載せる構成を指す。

## 3. なぜ今か（2026年の量産事実・完成条件 2）

| # | 事実 | 状態 | 出典 |
|---|---|---|---|
| 1 | NVIDIA Spectrum-X Ethernet Photonics が Vera Rubin 向けに量産入り。200Gb/s SerDes の CPO スイッチと説明 | VERIFIED（発表の存在）/ CLAIM（電力5倍等の効率値） | https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Vera-Rubin-Ramps-Into-Full-Production-to-Power-Agentic-AI-Factories-Worldwide |
| 2 | Broadcom Tomahawk 6 Davisson（102.4Tbps, CPO, TSMC COUPE 採用の光エンジン16基）の出荷発表 | VERIFIED（発表は 2025-10-08）。出荷か sampling かは資料で食い違い | https://www.storagereview.com/news/broadcom-ships-tomahawk-6-davisson-cpo-ethernet-switch-doubling-bandwidth-to-102-4-tb-s-for-ai-fabrics |
| 3 | TSMC COUPE の 2026 年 volume production 目標。報道で状態が分かれる | 量産「目標」は VERIFIED（報道ベース）。実稼働の段階は UNVERIFIED | https://www.trendforce.com/news/2026/04/01/news-silicon-photonics-race-intensifies-as-tsmc-targets-2026-coupe-production-samsung-eyes-2029-cpo-turnkey/ |

注意:
- Broadcom は「出荷」と「sampling（BCM78919）」の記述が資料間で違う。動画では「出荷発表」とだけ書き、一般提供の時期は断定しない。
- Issue 本文の Meta「100万 port device hours」の実績値は今回未検証。使う場合は `UNVERIFIED` を外すまで本文に入れない。
- Issue 本文の「TSMC 2025年 200Gbps」は今回未検証。
- NVIDIA の「5倍」「4x fewer lasers」等は企業側の数値で、独立測定ではない。

## 4. 技術説明と投資仮説の分離

動画は二層に分ける。

- 技術層（事実寄り）: 電気配線の距離と損失、pluggable の DSP/retimer の電力、CPO で光変換を ASIC 隣接へ移す構造。
- 投資層（仮説）: 「量産開始でサプライチェーンの売上が立つ段階に入った」。売上の寄与は各社の決算一次資料で個別に確認するまで断定しない。

投資層の文言には必ず「仮説」「確認が必要な点」を付ける。個別銘柄の推奨にはしない。

## 5. 業界地図（完成条件 3: 最低5社の役割区別）

| 層 | 企業 | 役割（区別の要点） | 状態 |
|---|---|---|---|
| 1. スイッチ / XPU 設計 | NVIDIA | Spectrum-X Photonics を Vera Rubin に組み込む | VERIFIED |
| 1. スイッチ / XPU 設計 | Broadcom | Tomahawk 6 Davisson（CPO スイッチ ASIC） | VERIFIED（出荷状況は要確認） |
| 2. Foundry / 光集積 | TSMC | COUPE（光エンジンの製造・統合） | VERIFIED（量産時期は報道差あり） |
| 3. 光デバイス / レーザー | Coherent | 6.4T SiPh CPO、外部レーザー、InP 変調器（OFC 2026 展示） | UNVERIFIED（Issue 記載の展示内容は未確認） |
| 3. 光デバイス / レーザー | Lumentum | 外部レーザー等の関与 | UNVERIFIED |
| 4. Packaging / 光ファイバー・コネクタ | SPIL（ASE 系） / Fabrinet / Foxconn | 先端パッケージ、組立 | UNVERIFIED |
| 4. Packaging / 光ファイバー・コネクタ | Corning / Sumitomo Electric / Senko | ファイバー・コネクタ | UNVERIFIED |

「NVIDIA のパートナーだから恩恵」とは言わない。各社の製品・量産採用・売上露出を一次資料（決算資料・プレスリリース）で個別確認してから記述する。

## 6. 投資家が見る指標（確認候補）

- スイッチ帯域（Tbps）、レーン速度（200G → 400G）
- 1ビットあたりのネットワーク電力
- 光エンジン出荷数、CPO の attach rate
- pluggable から CPO への置換速度
- 先端パッケージ能力、hyperscaler / AI クラスタの採用実績

いずれも数値の出典を一次資料に限定する。

## 7. 反証（完成条件 4: 最低3件）

1. CPO が pluggable を全面置換するとは限らない。scale-up と scale-out で採用速度が異なる可能性。
2. pluggable 側の改善、LPO / LRO との競争が残る。
3. 熱・歩留まり・保守性、外部レーザーの信頼性、量産コストが未解決の論点。
4. 企業発表の効率値（5倍等）は独立検証されていない。

## 8. 動画構成（5〜8分版、Short 版は別途圧縮）

0. Hook: 「GPUを100万個買っても、つなげなければ巨大な暖房器具です。」
1. 何が詰まっているか（電気配線、retimer、pluggable の電力）
2. シリコンフォトニクスとは（30秒説明）
3. CPO で何が変わるか（Before / After の模式図）
4. なぜ 2026 年が転換点か（量産事実 3件）
5. 業界地図（4層）
6. 投資家が見る数字
7. 反証
8. Ending: 「GPUの次の半導体」ではなく、「GPUを動かすために何が物理的に不足するか」を追う

タイトル候補・サムネイル案は Issue 本文のものを採用可能。サムネイルは「光へ」の1語とし、Before / After の物理構造で見せる。

## 9. yt3 canonical pipeline への接続

episode → research → verified facts → script → media → audit → publish

- research: 本書 §3 / §5 の一次 URL を verified facts の初期入力にする。
- verified facts: `VERIFIED` のみ台本の断定に使う。`CLAIM` は「発表では」と限定して書く。`UNVERIFIED` は台本に入れない。
- script / media / audit: 本計画の段階では未実施。
- publish: 公開は別途の明示的承認が必要（AGENTS.md の publication 規則に従う）。本計画は公開を含まない。

## 10. 残件（Issue 調査タスクとの対応）

| Issue タスク | 状態 |
|---|---|
| NVIDIA Spectrum-X Photonics の製品・量産時期・採用先を一次資料で固定 | 一部完了（発表・量産の存在）。採用先の一次確認は残件 |
| Broadcom Tomahawk 6 / CPO の量産状況と Meta 実証値 | 残件（出荷と sampling の食い違い、Meta 値は未確認） |
| TSMC COUPE のロードマップと顧客・量産ステータス | 一部完了。顧客・実稼働段階は残件 |
| Coherent / Lumentum / Corning / Sumitomo / SPIL / Fabrinet の売上露出監査 | 未着手（UNVERIFIED） |
| CPO vs pluggable vs LPO/LRO の比較表 | 未着手 |
| 主要構成部品の分解（設計 / foundry / laser / modulator / packaging / connector / fiber） | 本書 §5 で骨格のみ |
| 各社の直近 CapEx・売上・受注 | 未着手 |
| 5〜8分版 script | 未着手 |
| 60秒 Short 版 | 未着手 |
| 業界地図 1枚・Before/After 図 1枚 | 未着手 |

## 11. 完成条件の現状

- [ ] 30秒説明: §2 で文案あり。音声・尺での確認は未実施。
- [ ] 2026年量産事実 3件: §3 で3件の出典を記載。ただし #3 の実稼働段階は UNVERIFIED。
- [ ] 最低5社の役割区別: §5 で8社を層別に記載。Coherent 以外の光デバイス・パッケージ社は UNVERIFIED。
- [x] 技術説明と投資仮説の分離: §4。
- [x] 反証3件以上: §7 で4件。
- [ ] 重要数値に一次 URL: 主要数値は §3 に URL あり。売上・採用の数値は未取得。
- [ ] yt3 pipeline への投入: 未実施（script 以降が未作成）。
