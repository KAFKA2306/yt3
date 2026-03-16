# ADR-0003: Zero-Fat Crash-Driven Development 🎀

## Status

Accepted ✨

## Context

リポジトリの成長に伴い、冗長な例外処理や不透明なリトライロジックが、問題の本質（Root Cause）を覆い隠してしまうリスクが高まっていた。また、古くなったコメント（Docstrings）がコードの現状と乖離し、誤解を招く原因となっていた。

エージェントが「失敗から最速で学ぶ」ためには、クラッシュを恐れず、明確なスタックトレースを維持する「鉄の掟」が必要である。

## Decision

以下の「鉄の掟」を全コードベースに適用し、恒久的に維持する：

1. **No try-catch in business logic**:
   - ビジネスロジック内での例外キャッチを禁止する。エラーが発生した場合は即座にクラッシュさせ、完全なスタックトレースを露出させる。

2. **No retry logic in code**:
   - アプリケーションコード内でのリトライループを禁止する。リジリエンスはインフラ層（Taskfile, systemd, Kubernetes 等）で解決する。

3. **No comments/docstrings**:
   - TODO/FIXME 以外のコメントを禁止する。説明が必要な場合は、変数名や関数名の改善（Naming as Documentation）によって解決する。

4. **Strict Type Hints**:
   - 自然言語による説明の代わりに、型ヒント（TypeScript/Zod, Python/Pydantic）を究極のドキュメントとして使用する。

5. **No Boilerplate/Mocks**:
   - 不要な抽象化やモックコードを排除し、常に「本物のデータ」と向き合う。

## Consequences
- コードが劇的にスリムになり、読みやすさが極限まで高まる。
- バグが発生した際、隠蔽されることなく即座に検知・修正可能になる（Fail Fast）。
- インフラ層とアプリケーション層の責務が明確に分離される。
- 型定義の重要性が増し、静的解析による品質維持が容易になる。
