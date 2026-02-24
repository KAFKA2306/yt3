---
description: 全thumbnail pngのprogramatic reviewとその改善の試作ループを実施し、安定的に素晴らしいthumbnailが生成されることと、それを的確に評価するプログラムを獲得する
---

// turbo-all
# ビジュアル・オートメーション・グローバル最高水準版 (Visual Automation v2.2 Elite)

本プロトコルは、人間の美的感覚をプログラムに移植し、`runs/` ディレクトリ内の全アセットを**「破壊的にレビュー（容赦のない品質チェック）」**した上で、完全自律的に修正・出力するための**極致品質基準**です。2026年の金融メディアにおいて、視覚情報は「知的インフラ」であり、単なる装飾ではありません。

---

## 1. 知覚・トレンド解析 (Global Intel)

1. **コンテキストの強制抽出**:
   - `runs/${RUN_ID}/research/output.yaml` から `director_data.angle` を取得。
   - 感情トーン（Fear/Greed/Neutral）に基づき、パレットのコントラスト比を動的に調整せよ。

2. **2026年金融黄金律 (色彩・心理)**:
   - **Base (60%)**: #103766 (Deep Blue) — 信頼と権威の象徴。
   - **Support (30%)**: #FFFFFF — 明快な事実と透明性。
   - **Accent (10%)**: #288CFA (High-energy) or #C62828 (Alert) — 視聴者のドーパミンを刺激する視覚的フック。

---

## 2. エリート・タイポグラフィ・スタック (Elite Typography)

日英混在環境において、300ms以内の認知を保証する「完璧なペアリング」を強制する。

1. **Display (タイトル・見出し用)**:
   - **Latin**: `Geist` (Weight: 900/Black) — 幾何学的で鋭利な美学。
   - **Japanese**: `IBM Plex Sans JP` (Weight: Bold/Black) — 低重心で力強いプロフェッショナリズム。
   - **Naming**: `font-family: 'Geist', 'IBM Plex Sans JP', sans-serif;`

2. **Readability (本文・字幕用)**:
   - **Latin**: `Atkinson Hyperlegible` — 誤認を防ぐための究極の可視性。
   - **Japanese**: `IBM Plex Sans JP` (Regular) — 長文でも疲れないモダンな空間設計。
   - **Naming**: `font-family: 'Atkinson Hyperlegible', 'IBM Plex Sans JP', sans-serif;`

3. **厳格ルール**:
   - **Weight**: サムネイル上のタイトルは 700(Bold) 以上必須。900(Black) を推奨。
   - **Spacing**: Geist 使用時は `letter-spacing: 0px` を基準とし、文字の衝突（Overlap）を IQA で検知せよ。

---

## 3. アセット高速錬金 (Asset Alchemy)

1. **AI美学プロンプト (2026 Elite Pattern)**:
   - `generate_image` 使用時は以下のメタ記述を必須とする：
     `cinematic finance district, anamorphic lens flare, Arri Alexa color science, soft rim lighting, ultra-sharp 8k, professional architectural symmetry.`

2. **チャートの統合**:
   - 金融データの信頼性を視覚化するため、`mcp-server-pptx` 等を用いて生成した実数値チャートを背景にレイヤー化せよ。

---

## 4. 破壊的な品質レビュー (Elite IQA Gating)

`src/utils/iqa_validator.ts` による自動審査を通過しないアセットは、本番環境への到達を一切禁ずる。

| 評価項目 | 合格基準 | テクニカル指標 |
| :--- | :--- | :--- |
| **鮮鋭度 (Sharpness)** | > 100 | Variance of Laplacian (VoL) |
| **コントラスト比** | >= 7:1 | WCAG 2.1 AAA (最小 5:1 で警告) |
| **x-height 可読性** | >= 0.35 | 小文字領域の垂直ピクセル密度 |
| **モバイルエッジ強度** | >= 30 | 150pxリサイズ時の Laplacian 勾配 |
| **超速認知スコア** | >= 0.7 | `0.4*Contrast + 0.4*xHeight + 0.2*Simplicity` |

---

## 5. 無慈悲なフェイルファスト (Fail-Fast Logic)

1. **品質の聖域化**:
   - いかなる理由があろうとも、IQA基準を下回るアセットの出力は許されない。
   - 基準未達時は `throw new Error` によってプロセスを即座に停止し、再実行を促す。
   - 「妥協した成果物」はAIメディアの信頼性を根底から破壊する。

---

## 6. 記録と進化 (Finalization)

- 審査通過後の `logs/visual_quality_audit.json` 保存は義務である。
- 蓄積されたデータは、次世代の「美学モデル」の学習データとして、システムの自己進化に供される。
