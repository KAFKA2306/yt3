# 開発ガイドライン (Development Manifesto)

**コードベースの最小化と確実な動作の追求。**

## 開発の基本指針 (Core Guidelines)

1.  **最小化 (Minimize)**: コード量は少ないほどメンテナンス性が高まります。不要な機能、ファイル、依存関係を極限まで排除してください。
2.  **重複排除 (DRY)**: コードの複製は保守の妨げとなります。共通のロジックはすべて `src/core.ts` に集約してください。
3.  **設定駆動 (Config-Driven)**: コード内に直接値を記述することは避けてください。すべてのパラメータは `src/core.ts` を介して `config/*.yaml` から読み込むようにします。
4.  **コメントの最小化 (Self-Documenting)**: コード自体がその意図を明確に伝えるドキュメントであるべきです。補足が必要な場合は、ロジックをより分かりやすく書き直してください。
5.  **Fail Fast (迅速な失敗)**: エラーを隠蔽せず、問題が発生した時点で速やかに停止し、原因を特定しやすくしてください。
6.  **継承 (Inheritance)**: エージェントの一貫した振る舞いを保証するため、すべてのエージェントクラスは `BaseAgent` (`src/core.ts`) を継承してください。
7.  **ドキュメント規定 (Docs)**: 透明性を維持するため、すべての公式な記述は「日本語のみ」で行ってください。
8.  **厳格な型定義 (No any)**: `any` 型の使用は技術的負債となります。TypeScript の恩恵を最大限に受けるため、厳密な型定義を心がけてください。

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
