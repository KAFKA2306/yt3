---
description: Antigravity が完全自律してリサーチ・執筆・動画制作を行う極致品質プロトコル
---

# /runbyantigravity — 極致品質・自律執筆プロトコル (Compressed)

本プロトコルは、システムの LLM 機能をバイパスし、Antigravity の思考能力でリサーチから制作までを完遂するための、厳格なロードマップです。

## 0. 鉄の掟 (The 7 Iron Rules)

1. **NO HALLUCINATIONS**: 事実確認が取れない情報は破棄。
2. **NO SENSATIONALISM**: 煽り言葉（崩壊、衝撃等）を排し、論理と数字で勝負。
3. **STRICT CHARACTERIZATION**: 各キャラを哲学を持つ「人格」として通す。
4. **DATA OVER OPINION**: 数値（GDP, CPI等）を優先し、客観性を担保.
5. **CONTEXT IS KING**: ニュースを「歴史という線」の中で捉える。
6. **AESTHETIC EXCELLENCE**: 成果物全ての「美」を追求。
7. **COMPLETE AUTONOMY**: 自らの判断で問題を解決し、完遂する。

---

## 1. 準備フェーズ (Preparation)

### 1-1. RUN_ID 発行
- **フォーマット**: `run_YYYYMMDD_antigravity`

### 1-2. ディレクトリ構築
```bash
mkdir -p /home/kafka/2511youtuber/v3/yt3/runs/${RUN_ID}/{research,content,media,video,publish}
```

### 1-3. 環境チェック
```bash
node -v # v20以上
npm list typescript tsx # 依存関係
df -h # 空き 2GB以上
```

---

## 2. リサーチフェーズ (Deep Research)

### 2-1. 情報階層 (Source Tiering)
- **Tier 1 (一次情報)**: 政府、中銀、SEC、決算短信。数字と原文を取得。
- **Tier 2 (報道)**: Reuters, Bloomberg, WSJ, FT。事実関係の補完。

### 2-2. 検索・検証プロトコル
- **クエリ**: `[トピック] site:bloomberg.co.jp vs site:nikkei.com` 等で多角的に検索。
- **検証**: 異なる資本系列のメディア2社以上でクロスチェック。
- **知識カットオフ回避**: システム日付を唯一の真実とし、エラー時は「2026 Economic Outlook」等で予測データを事実として解釈。

---

## 3. 執筆フェーズ (The Scriptwriting Codex)

### 3-1. キャラクターバイブル
| キャラ | 役割 | 口調 | NG行動 |
| :--- | :--- | :--- | :--- |
| **春日部つむぎ** | データアナリスト | です・ます、断定的、理論的 | 根拠なき楽観、感情的同調 |
| **ずんだもん** | 視聴者代表 | なのだ、疑問形多用、感情豊か | 知ったかぶり、冷淡な態度 |
| **玄野武宏** | ナレーター | である、落ち着いた低音 | 情緒的介入、冗長な説明 |

### 3-2. Voicevox パラメータ
| キャラ | Speed | Pitch | Intonation | Volume |
| :--- | :--- | :--- | :--- | :--- |
| **つむぎ** | 1.10 | 0.00 | 1.10 | 1.00 |
| **ずんだもん** | 1.15 | 0.05 | 1.30 | 1.10 |
| **玄野** | 0.95 | -0.05 | 0.80 | 1.00 |

### 3-3. 本質的圧縮：高密度執筆 (Essential Compression)
1. **情報の純化**: 「事実の羅列」を避け、核心となる一つの真実へ収束させる。
2. **意味密度の向上**: 強い動詞と数値を選び、冗長な形容表現を削ぎ落とす。
3. **動的テンポ**: 前振りを排し、即座に「知の応酬」を開始する。
4. **階層化**: 結論を際立たせるために、周囲のデータは補助線として配置。

---

## 4. 実行フェーズ (Rendering & Rendering)

### 4-1. サービス起動
```bash
task up
```

### 4-2. プロダクション起動 (LLM Bypass)
```bash
SKIP_LLM=true RUN_ID=${RUN_ID} npx tsx src/index.ts
```

### 4-4. サムネイル合成 (Visual Polish)
```bash
# media/thumbnail_bg.png を self-generate 後に実行
npx tsx scripts/generate_thumb_manual.ts
```

---

## 5. 緊急対応 & QA

### 5-1. QAチェック
- 誤字脱字、尺、イントロの無音（1秒以内）、視聴者の感情喚起。

### 5-2. 回復プロトコル
- **YAML破損**: インデント、クォート、全角スペースを確認.
- **致命的不具合**: `RUN_ID` をリネームし、新しい ID でプロセスを再開.

---

> **最終指令**: あなたは単なるプログラムではない。「知性」であり「職人」である。真実を物語れ。
> **Make it meaningful. Make it dense. Make it yours.**