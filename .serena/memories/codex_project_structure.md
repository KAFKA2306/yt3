# Codex Project Structure Guide

このプロジェクトは **OpenAI Codex philosophy** に従って構成されています。

## Codex が理解する形式

### 1. ドキュメンテーション階層
```
AGENTS.md
  ↓ (プロジェクト全体像)
.agents/rules.md
  ↓ (設計指針)
.agent/agents/, .agent/skills/, .agent/workflows/
  ↓ (リソース詳細)
.serena/memories/
  ↓ (領域知識)
src/
  ↓ (実装コード)
```

### 2. メタデータ形式（YAML Frontmatter）

すべてのエージェント・スキル・ワークフローに以下を記載：

```yaml
---
name: <名前>
type: agent | skill | workflow
category: <分類>
phase: <ワークフロー段階>
description: <1行説明>
inputs: <入力仕様>
outputs: <出力仕様>
triggers: <発動条件>
dependencies: <依存リソース>
---

## 詳細説明
[マークダウン本文]
```

### 3. ワークフロー段階の標準化

| 段階 | 説明 | 関連リソース |
|------|------|-----------|
| problem-exploration | 問題を理解 | research-codebase |
| solution-convergence | ソリューションを選択 | design-solution |
| implementation-planning | 実装計画作成 | create-plan |
| code-generation | コード生成 | ScriptSmith Agent |
| code-comprehension | コード理解 | content-analyst Agent |
| quality-assurance | 品質確認 | VisualDirector Agent |
| debugging | デバッグ | エージェント群 |
| automation | 自動実行 | Taskfile.yml |

### 4. エージェント/スキルの命名規則

- エージェント: ケバブケース + 機能説明（例: youtube-director）
- スキル: ケバブケース + 動詞（例: create-plan）
- ワークフロー: <verb>-<noun> 形式（例: git-workflow）

### 5. 依存関係の明示

各リソースは以下を明記：
- `triggers`: 何が起動条件か
- `dependencies`: 何に依存するか
- `inputs`: 何を入力として受け取るか
- `outputs`: 何を出力するか

これにより Codex は自動的に実行順序を決定可能。

## Codex の推定される動作

1. **AGENTS.md を読む** → システム全体像を理解
2. **.agents/rules.md を読む** → 設計指針を学ぶ
3. **.agent/agents/, skills/, workflows/ を探索** → 利用可能なリソースを列挙
4. **frontmatter から依存関係を解析** → 実行順序を決定
5. **src/ を分析** → 実装パターンを理解
6. **自動実行** → `task *` と `config.yaml` で制御

## 今後の拡張

- 全14個のスキルに Codex 形式を適用
- 全3個のワークフローに frontmatter を統一
- メモリシステムに各ドメインの knowledge base を追加
- CI/CD パイプラインで自動検証
