# ADR 0040: Quality-Diversity (QD) Driven Cognitive Ecology & Archive Architecture 🌸

## 📝 プロベナンス表示 (Claim Provenance)
- **VERIFIED**: `src/domain/humanity_audit/humanity_audit_v2.ts` における 5 次元のエントロピー計算ロジックの実装を確認。
- **OBSERVED**: 2026 年時点での PCG (Procedural Content Generation) および QD (Quality-Diversity) におけるベストプラクティス（MAP-Elites, CMA-ME, pyribs/QDax 的アプローチ）をインテーク。
- **INFERRED**: 単一の台本を PASS/FAIL 判定するだけでは「長期的なパターンの死滅（Model Collapse）」を防ぎきれない。アーカイブ全体の「充填率（Coverage）」と「多様性スコア（QD-score）」を目的関数として生成ループを回す必要がある。

---

## 状態
決定済み（Accepted） ✨

---

## コンテキスト（背景）
ADR-0039 で導入した「認知多様性（Humanity Entropy）」監査は、個別の台本が「人類観測所らしさ」を備えているかを保証する優れたゲートである。しかし、このゲートを通過した台本を「無作為に」量産し続けると、アーカイブ全体として見た時に「朝の台本ばかり増える」「似たような感情の動きが続く」といった、高次元空間における **「パターンの偏り（Clustering）」** が発生する。

真の人類観測（Cognitive Ecology）を実現するためには、個別の「品質（Quality）」だけでなく、アーカイブ全体の「多様性（Diversity）」を能動的に拡大する **Quality-Diversity (QD) アルゴリズム** の思想を導入する必要がある。

---

## 決定事項

### 1. 行動特徴空間 (Behavioral Characteristics: BC) の定義
`humanity_audit_v2.ts` で定義された 5 つの次元を、MAP-Elites における特徴空間（Grid）として扱う。

| 次項 (BC) | 次元 | 目的 |
| :--- | :--- | :--- |
| **BC1: Time** | 24h Grid | 生活時刻の網羅（深夜3時の孤独〜昼12時の喧騒） |
| **BC2: Season** | 4 Seasons / Weather | 季節感と気象の多様性（雨の匂い、冬の冷気） |
| **BC3: Space** | Room / City / Nature | 観測地点の多様性（ベランダ、洗面所、レジ前） |
| **BC4: Object** | Mundane Ontology | 生活錨（Anchor）の重複回避（レシート、イヤホン、充電器） |
| **BC5: Emotion** | Emotional Gradient | 感情のグラデーション（ささやかな祝祭、恥ずかしさ、安心） |

### 2. 認知レパートリー・アーカイブ (Cognitive Repertoire Archive)
- `data/humanity_audit/archive.json` を SSOT とし、過去に PASS した台本の BC 座標（重心ベクトル）を記録する。
- **Coverage (充填率)**: アーカイブ内の埋まっているセルの割合。
- **QD-score**: $\sum (\text{Retention Score} \times \text{Novelty})$。※現状は Retention の代わりに Audit Score を使用。

### 3. QD 駆動型生成ループ (QD-Driven Generator)
生成プロセスを「単発の命令」から「アーカイブの空白を埋める探索」へと変更する。

1.  **Gap Detection**: アーカイブをスキャンし、最も「希薄な領域（例：平日の昼 / 玄関 / 焦燥感）」を特定する。
2.  **Constraint Injection**: 特定された空白領域を、生成エージェント（ScriptWriter）への **「絶対命令（Mandatory Constraints）」** として注入する。
3.  **Elite Selection**: 複数の候補を生成し、アーカイブの Coverage を最も向上させる（または既存のエリートを更新する）ものを採用する。

### 4. ゼロトラスト QD 監査
「多様性」という名目での「質の低下」や「設定の崩壊」を許さない。
- **Novelty Audit**: 過去 5 回の実行と BC が一定以上の距離（Cosine Similarity 等）を持っていることを検証。
- **Clustering Penalty**: 特定の単語やシチュエーションが密集している場合、Audit FAIL とする。

---

## 帰結

*   **メリット (Benefits)**:
    *   長期運用において、人類観測所の内容が「お決まりのパターン」に陥るのを数学的に防止できる。
    *   視聴者に対して、常に「新鮮だが、どこか懐かしい（生活に根ざした）」多様な観測結果を提示し続けられる（視聴維持率の向上）。
*   **デメリット (Trade-offs)**:
    *   生成コストの増大（空白を埋めるための複数回の試行）。
    *   アーカイブ管理という新たな状態（State）の維持が必要。

---

## 🌸 2026 基準の最終目標 (Elite Goal)
「生成モデルが人間を模倣するのではなく、人間がまだ言語化できていない『生活の断片』を、QD 探索によってアーカイブの空白から発見し、提示する」状態を目指す。
