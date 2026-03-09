# ADR-0001: Autonomous Harness Engineering

## Status
Accepted

## Context
リポジトリの成長に伴い、ドキュメントの腐敗やテストの形骸化、エージェントによる設定ファイルの意図しない変更が問題となっていた。これらを人間が手動で監視し続けるのはスケールしないため、エージェント自身が品質を維持・向上させるための「自律型ハーネス」が必要である。

## Decision
以下の3つの柱を導入する：
1. **Claude Code Hooks**: 保存時に自動リント (PostToolUse) と設定ファイルの保護 (PreToolUse) を行う。
2. **ADR Automation**: `task adr:new` を用意し、全ての重要な設計変更を ADR として記録することをエージェントに義務付ける。
3. **Repository Doctor**: `task harness:doctor` を定期実行し、リンク切れやダミーテストなどの「腐敗」を自動検知する。

## Consequences
- エージェントが Biome のルールを無視したり、`any` を使ったりすることが物理的に困難になる。
- 手動ドキュメントよりも、機械的に検証可能な ADR とテストが優先される文化が醸成される。
