# Memory Index - Hierarchical Loading Strategy

Hierarchical memory system for context compression. Layers are loaded based on task context to maximize token efficiency.

## Layer 1: Core (Always Loaded) ~3-5k tokens

Essential directives that guide all development work.

- [開発ディレクティブ](layer1_core/development_directives.md) — 最小実装原則、ビルド・実行・品質基準
- [モデル向けビヘイビア指令](layer1_core/model_behavior_directive.md) — コンテキスト汚染対策、隔離ルール
- [コーディング規約](layer1_core/style_conventions.md) — 命名規則、ファイル構成、型安全性

## Layer 2: Development (Load During Coding) ~5-8k tokens

Reference during feature implementation, debugging, and architecture decisions.

- [プロジェクト概要](layer2_development/project_overview.md) — ドメイン知識、主要モジュール
- [推奨コマンド](layer2_development/suggested_commands.md) — ビルド・テスト・デバッグコマンド
- [Codex プロジェクト構造](layer2_development/codex_project_structure.md) — ドキュメント階層、メタデータ形式、エージェント命名規則

## Layer 3: Reference (On-Demand) unlimited

Context-dependent information loaded only when needed.

- [Task Completion Status](layer3_reference/task_completion.md) — タスク完了状況の追跡
- [Architecture](layer3_reference/architecture/) — システム設計、統合結論
- [Collaboration](layer3_reference/collaboration/) — チーム座標、エージェント間連携
- [Task Context](layer3_reference/task/) — 統合タスク状況
- [YT3 Patterns](layer3_reference/yt3/) — ドメイン固有パターン、開発インスティンクト

---

## Token Budget Allocation

| Layer | Usage | Typical Load Time |
|-------|-------|-------------------|
| **Layer 1** | 3-5k | Always (start of conversation) |
| **Layer 2** | 5-8k | When coding/architecture work detected |
| **Layer 3** | Unlimited | Manual reference via file read |

## Loading Strategy

1. **Session Start**: Layer 1 always loaded
2. **Coding Work Detected**: Add Layer 2 if task involves implementation
3. **Reference Needed**: Read Layer 3 files individually via tool calls
4. **Context Pressure**: Layer 2 can be dropped first, Layer 3 never auto-loaded

## Memory Lifecycle

- **Core values** (Layer 1): Update when fundamental directives change
- **Development patterns** (Layer 2): Refresh when architecture or workflow changes
- **Reference data** (Layer 3): Append new entries without disrupting active work

## Updating Memories

- Create new files in appropriate layer directory
- Update index lines only (keep MEMORY.md under 200 lines)
- Use subdirectories for topic organization within layers
- Document loading triggers in file frontmatter
