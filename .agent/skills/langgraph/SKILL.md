# LangGraph設計 (鉄の掟)

**目的**: `src/graph.ts` におけるステート管理とオーケストレーションの標準化。

## 鉄の掟 (Rules)

1.  **純粋関数ノード (Pure Functions)**:
    -   入力はState、出力はState差分のみ。
    -   副作用は `AssetStore` (`save`, `logOutput`) のみに限定せよ。

2.  **厳密な型定義 (Strict Typing)**:
    -   `src/types.ts` の `AgentState` を使用せよ。
    -   `src/graph.ts` の `channels` 定義で reducer を明示せよ。

3.  **最小ステート (Minimal State)**:
    -   全チャット履歴を保持するな。トークン破産する。
    -   `summary` や `context` フィールドを活用し、情報を圧縮して保持せよ。

4.  **エラーハンドリング (Fail Fast)**:
    -   複雑な条件分岐エッジを作るな。
    -   `agent.run()` が失敗したらグラフを停止させよ。問題の隠蔽は悪だ。

5.  **設定駆動 (Config Driven)**:
    -   ノードの挙動（プロンプト、閾値）は全て `src/core.ts` の `loadConfig()` / `loadPrompt()` から取得せよ。
