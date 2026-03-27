# よく使うコマンド
## 開発フロー（Taskfile）
- `task bootstrap`: 依存導入 + サービス起動
- `task up` / `task down` / `task status`: 背景サービス管理
- `task run -- "<topic>"`: 本番ワークフロー実行
- `task dryrun`: 安全実行（SKIP_LLM=true, DRY_RUN=true）
- `task research|content|media|publish`: ステップ単体実行
- `task publish:dry`: 公開ステップのドライラン
- `task serve`: ダッシュボード起動
- `task test`: テスト
- `task lint`: 型チェック + lint（Taskfile 上は `npx tsc --noEmit` と `npx eslint src`）

## package.json scripts
- `bun run test`
- `bun run lint`（Biome check）
- `bun run format`（Biome format --write）
- `bun run check`（Biome check --write）
- `bun run typecheck`（tsc --noEmit）

## 直接実行
- `bun --env-file=config/.env src/index.ts "<topic>"`
- `bun --env-file=config/.env src/step.ts <research|content|media|publish> ...`

## Linux 基本コマンド
- `ls`, `cd`, `pwd`, `rg`, `find`, `git status`, `git diff`