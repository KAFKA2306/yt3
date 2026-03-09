# ADR-0002: Harness Maintenance Skill Introduction

## Status

Accepted

## Context

自律型ハーネス（Hooks, ADR, Doctor）を導入したが、将来のセッションでエージェントがこれらの重要性を理解せず、ルールを形骸化させてしまうリスクがある。エージェントが常にハーネスの整合性を意識し、自らメンテナンスし続けるための規範が必要である。

## Decision

`harness-maintenance` スキル (`.agent/skills/harness-maintenance/SKILL.md`) を導入し、以下の「鉄の掟」を定義する：
1. **ADR First**: 全ての決定を ADR に記録する。
2. **Hook Integrity**: フックをバイパスしない。
3. **Doctor Validation**: 完了前に `task harness:doctor` を実行し、腐敗を解消する。

## Consequences

- エージェントが自発的に ADR を作成するようになり、意思決定の透明性が向上する。
- リンク切れやダミーテストが放置されなくなり、リポジトリの鮮度が維持される。
