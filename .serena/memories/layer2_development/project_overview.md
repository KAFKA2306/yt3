# プロジェクト概要
- 名称: yt3
- 目的: AI を使って金融系動画を自動生成し、リサーチから台本・音声/動画生成・公開までをワークフロー化する。
- 主な実行基盤: Bun + TypeScript + LangGraph。

# 技術スタック
- ランタイム/パッケージ/テスト: Bun
- 言語/型: TypeScript（strict）, Zod
- LLM: Gemini（LangChain 経由）
- ワークフロー: @langchain/langgraph
- メディア: Voicevox / FFmpeg / Sharp
- 補助: Express（ダッシュボード）, Discord Bot 連携

# 主要構成
- src/index.ts: フルワークフローのエントリーポイント
- src/graph.ts: LangGraph 定義
- src/core.ts: 共通基盤（設定読み込み、ユーティリティ、AssetStore、BaseAgent）
- src/agents/: research/content/media/publish/memory などの各エージェント
- src/step.ts: ステップ単体実行用エントリ
- config/default.yaml: 設定の中心
- config/.env: 実行時シークレット
- tests/core.test.ts: コアユーティリティのテスト

# 補足
- AGENTS.md に開発マニフェストが定義されており、`src/core.ts` を Single Source of Truth とする方針。