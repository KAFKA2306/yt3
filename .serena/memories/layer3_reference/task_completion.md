# タスク完了時チェック
- 変更方針が AGENTS.md の指針（最小化、DRY、Config-Driven、Fail Fast、No any）に沿っていることを確認。
- 影響範囲に応じて最低限以下を実行:
  - `bun run typecheck`
  - `bun run test` または `task test`
  - フォーマットが必要なら `bun run format`
  - 静的検証は `bun run lint`（Biome）
- 公開系処理は原則 `task dryrun` / `task publish:dry` で先に検証。
- 外部連携（YouTube/X/LLM）を伴う変更は `DRY_RUN` / `SKIP_LLM` を使って安全確認してから本番実行。