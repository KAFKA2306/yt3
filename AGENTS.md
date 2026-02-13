# 開発ガイドライン (Development Manifesto)

**コードベースの最小化と「動く」ことへの執着。**

## 鉄の掟 (Iron Rules)

1.  **最小化 (Minimize)**: コード量は罪。機能を減らし、ファイルを減らし、依存を減らす。
2.  **重複排除 (DRY)**: コピペ厳禁。共通ロジックは全て `src/core.ts` に集約せよ。
3.  **設定駆動 (Config-Driven)**: ハードコーディング即死。全て `src/core.ts` 経由で `config/*.yaml` から読み込め。
4.  **コメント禁止 (No Comments)**: コード自体がドキュメントだ。補足が必要なコードは書き直せ。
5.  **エラーハンドリング禁止 (Fail Fast)**: `try-catch` で隠蔽するな。クラッシュさせてバグを直せ。
6.  **継承 (Inheritance)**: 全てのAgentは `BaseAgent` (`src/core.ts`) を継承せよ。
7.  **ドキュメント (Docs)**: 日本語のみ記述せよ (Write in Japanese only)。
8.  **any禁止 (No any)**: `any`型は技術負債。厳密に型定義せよ。

## アーキテクチャ (Structure)

**Single Source of Truth**: `src/core.ts`

-   **src/**
    -   `index.ts`: Entry Point.
    -   `graph.ts`: LangGraph Definition.
    -   `core.ts`: **CORE** (Config, Utils, AssetStore, BaseAgent).
    -   `types.ts`: **TYPES** (Models, State, Schemas).
    -   `layout_engine.ts`: **LAYOUT** (Visual Composition).
    -   **agents/**:
        -   `research.ts` (Strategy & Research)
        -   `content.ts` (Script & SEO)
        -   `media.ts` (TTS & Video Assembly)
        -   `publish.ts` (YouTube & X)
        -   `memory.ts` (Index & Essence)

## 技術スタック (Tech Stack)

-   **LangGraph.js**: Workflow Orchestration.
-   **Gemini**: LLM Inference (`gemini-3.0-flash-preview` REQUIRED).
-   **Voicevox**: Audio Synthesis.
-   **FFmpeg / Sharp**: Media Rendering.
