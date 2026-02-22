---
description: 全thumbnail pngのprogramatic reviewとその改善の試作ループを実施し、安定的に素晴らしいthumbnailが生成されることと、それを的確に評価するプログラムを獲得する
---

// turbo-all
# ビジュアル・オートメーション・破壊的改善版 (Visual Automation v2)

本プロトコルは、人間の美的感覚をプログラムに移植し、`runs/` ディレクトリ内の全アセットを**「破壊的にレビュー（容赦のない品質チェック）」**した上で、完全自律的に修正・出力するための**極致品質基準**です。2026年の金融メディアにおいて、視覚情報は「知的インフラ」であり、単なる装飾ではありません。本ワークフローは、AIによるコンテンツ生成が飽和した市場において、「魂を持つ映像」を300ms以内に視聴者の脳に刻み込むための、冷徹かつ情熱的なプロトコルです。

---

## 1. 知的情報収集 (Autonomous Intel)

1. **コンテキストの強制抽出**:
   - `runs/${RUN_ID}/research/output.yaml` を読み取り、動画の「核心的アングル」を特定。
   - 抽出すべき要素: `director_data.angle`（視覚的トーンの決定因子）、`director_data.title_hook`（サムネイルタイトル案）。
   - 例: `angle` が「警戒・利上げリスク」の場合、視覚トーンは「高コントラスト・赤アクセント」を選択する。

2. **MCPトレンド・オーバーライド**:
   - `context7` MCPサーバーを介し、2026年現在の高CTRニュース動画（金融系）の**色彩統計データ**を取得。
   - **2026年金融黄金律**: ベースカラー #103766 (Deep Blue) を基調とし、アクセント #288CFA (High-energy Blue) を組み合わせる。
   - 例: 「赤系のサムネイルはCTRを23%向上させるが、信頼性のために青ベースを維持し、暖色を10%のアクセントに抑える」といった具体的統計を適用せよ。

3. **2026年推奨パレット一覧**:

   | パレット名 | ベース | サポート | アクセント | 適用場面 |
   | :--- | :--- | :--- | :--- | :--- |
   | **Trust Blue** | #103766 | #FFFFFF | #288CFA | 金融分析・政策解説 |
   | **Alert Red** | #1A1A2E | #FFFFFF | #C62828 | 市場急変・警告報道 |
   | **Growth Teal** | #0D2137 | #E0F7FA | #00A3AF | 長期投資・成長戦略 |
   | **Premium Gold** | #0A0A12 | #F5F5F5 | #B89B47 | プレミアム分析・総括 |

---

## 2. デザイン・トークンの動的最適化 (Token Mutation)

1. **規約遵守の自動更新**:
   - リサーチ結果に基づき、`config/default.yaml` の `design_tokens` セクションを更新。
   - **60-30-10の法則**: ベース (60%) / サポート配色 (30%) / アクセント (10%) の比率を厳守。
   - **ロボット規約**: 最小コントラスト比 7:1 (WCAG AAA) を維持できない配色は自動パッチを適用し、補色関係を強制する。
   - **タイポグラフィ**: フォントは `Atkinson Hyperlegible` または `Geist` を最優先。x-height が低いフォント（細いセリフ体等）は即時排除。

2. **Fail-Fast バリデーション**:
   - 更新後の YAML を ESLint / Schema で自動検証。構文エラーがある場合は即座にプロセスを停止し、安全な `palettes[0]` にフォールバックせよ。
   - **コントラスト公式（必須チェック）**:
     ```
     C = (L_lighter + 0.05) / (L_darker + 0.05) >= 7.0
     ```
   - 上記を満たさないトークンの組み合わせは、生成段階に進む前に自動修正または棄却される。

3. **禁止トークン**:
   - コントラスト比 < 5:1 の配色
   - フォントウェイト < 700 (Bold未満)
   - テキスト文字数 > 15字/行（サムネイル上）
   - ぼかし (blur) や過度なグラデーションの単独使用

---

## 3. アセット高速錬金 (Asset Synthesis)

1. **Figma/PPTX 連携の厳格化**:
   - **Figma**: 抽象的なブランド要素、テクスチャ、UIパーツを `figma-dev-mode-mcp-server` から取得。ミクロな人間化（Micro-humanization）として、創設者のビデオメッセージやリアルな写真素材を活用。
   - **PPTX**: 信頼性を担保するための「事実の裏付け」として、`mcp-server-pptx` で数値データを可視化したチャート（PNG）を生成。Column, Line, Area チャートを優先する。

2. **AI美学プロンプトエンジニアリング（必須適用）**:
   - `generate_image` を使用する場合、以下のキーワードを必ず組み合わせる。

   | カテゴリ | 必須キーワード（例） |
   | :--- | :--- |
   | **カメラ** | `anamorphic lens`, `85mm portrait`, `shot on Arri Alexa` |
   | **ライティング** | `three-point lighting`, `dramatic rim light`, `soft diffused window light` |
   | **グレーディング** | `professional color grading`, `moody cinematic`, `rich shadows`, `high dynamic range` |
   | **解像度** | `8k`, `ultra-sharp`, `extreme detail` |
   | **シーン** | `cinematic finance district`, `night rain reflections`, `glass office with city view` |

   - **禁止プロンプト**: `anime`, `cartoon`, `simple`, `flat design`, `vector` — これらは即時棄却。

3. **アセット出力先と命名規則**:
   - 背景画像: `runs/${RUN_ID}/media/generated_bg.png`
   - チャートPNG: `runs/${RUN_ID}/media/chart_[n].png`
   - 最終サムネイル: `runs/${RUN_ID}/media/thumbnail.png`

---

## 4. 破壊的PNG品質レビュー (Programmatic IQA)

`runs/${RUN_ID}/` 内の全PNGを以下の「ロボット審査官」でチェックし、基準値を下回る場合は即座に破棄・再生成する。IQAは `src/utils/iqa_validator.ts` で実装されている。

1. **ピクセル・パーフェクト検証**:
   - 解像度 (1280x720) と色空間 (sRGB) の完全一致。
   - `sharp(imagePath).metadata()` でメタデータを取得し、`width === 1280 && height === 720` を厳密チェック。

2. **アルゴリズムによる鮮鋭度 (Sharpness)**:
   - `Variance of the Laplacian (VoL)` を計算。
   - Laplacianカーネル: `[0, 1, 0, 1, -4, 1, 0, 1, 0]`
   - 閾値: `VoL < 100` はボケ判定 → 即時不合格。
   - **なぜ重要か**: スクロール中の視聴者がサムネイルを認識するのは0.1秒以下。エッジが鋭い画像のみが視線を止める。

3. **コントラスト・バイナリチェック**:
   - **WCAG 2.1 AAA (7:1)** を目標とする。
   - 文字色と背景色のHEXから相対輝度 `L` を計算 → コントラスト比を算出。
   - `contrastRatio < 5.0` は即時エラー。
   - `5.0 <= contrastRatio < 7.0` は警告ログを残しつつ通過（要改善）。

4. **超速認知スコア (300ms Simulator)**:
   - x-height を最大化したフォント (Geist/Atkinson Hyperlegible) の使用を確認。
   - タイトルの単語数を5ワード以内に抑え、300ミリ秒以内での情報識別をシミュレート。
   - 認知スコアの計算: `0.5 * (contrast / 21) + 0.5 * (1 - titleLength / 50)`
   - **認知スコア < 0.6** は即時不合格。

5. **モバイル可視化シミュレート**:
   - 画像を 150px 幅にリサイズした際の文字エッジ強度を測定。
   - `sharp(imagePath).resize(150).toBuffer()` で縮小 → Laplacian再計算。
   - エッジ強度 < 30 は「モバイルで認識不能」と判定 → 再構成。

6. **IQA判定テーブル**:

   | 評価項目 | 合格基準 | 不合格時アクション |
   | :--- | :--- | :--- |
   | 解像度・色空間 | 1280x720 / sRGB | 即時Panic、メタデータ再設定 |
   | 鮮鋭度 (VoL) | > 100 | 即時Panic |
   | コントラスト比 | >= 7:1 (最小 5:1) | 即時Panic |
   | 認知スコア | >= 0.6 | 即時Panic |
   | モバイルエッジ強度 | >= 30 | 即時Panic |

---

## 5. 究極のフェイルファスト (Fail-Fast Enforcement)

1. **例外なき品質排除**:
   - IQA基準（鮮鋭度、コントラスト、認知スコア）のいずれか一つでも下回る場合、プロセスを即座に異常終了（Panic）させよ。
   - フォールバック、再試行、人間への相談は一切禁止とする。
   - 実装: `throw new Error(`Asset quality rejection: ${result.reason}`)` を `media.ts` の `run()` メソッド内で発火させる。

2. **なぜフォールバックを禁止するのか**:
   - 「魂のない完璧な映像」は2026年の視聴者に瞬時に見抜かれる。
   - 低品質のアセットが本番環境に到達した瞬間、チャンネルの信頼性は不可逆的に損なわれる。
   - 失敗は情報である。Panicによって失敗を明示し、次の実行を正しい状態から開始させる。

---

## 6. コミットと記録 (Finalization)

1. 審査を通過したアセットのみを Git に追加。
   ```bash
   git add runs/${RUN_ID}/media/thumbnail.png
   git commit -m "visual: certified thumbnail for ${RUN_ID} [IQA PASS]"
   ```

2. `logs/visual_quality_audit.json` に以下の証跡を保存する:
   ```json
   {
     "run_id": "run_YYYYMMDD_antigravity",
     "timestamp": "ISO8601",
     "status": "PASS",
     "attempts": 1,
     "metrics": {
       "sharpness": 142.7,
       "contrastRatio": 9.4,
       "isResolutionCorrect": true,
       "cognitiveRecognitionScore": 0.81,
       "xHeightLegibilityScore": 0.85
     }
   }
   ```

3. **品質証跡の活用**:
   - 蓄積されたログは、将来のデザイントークン自動最適化のトレーニングデータとして使用する。
   - `contrastRatio` の分布を分析し、高CTRと高コントラストの相関を継続的に評価せよ。
