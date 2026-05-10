---
name: engineering-standards
description: 開発基準と運用基準を統合するスキル。環境変数監査、型安全、フック遵守、ハーネス検証、Discord運用、開発前工程管理を扱う。
type: skill
---

# Engineering Standards

## 目的

実装品質と運用再現性を維持する。

## 必須パス

- ルート: `/home/kafka/2511youtuber/v3/yt3`
- 環境変数: `/home/kafka/2511youtuber/v3/yt3/config/.env`
- 設計記録: `/home/kafka/2511youtuber/v3/yt3/docs/adr/`
- 設定: `/home/kafka/2511youtuber/v3/yt3/.claude/settings.json`
- Discord通知実装: `/home/kafka/2511youtuber/v3/yt3/src/io/utils/discord.ts`
- Discord Bot実装: `/home/kafka/2511youtuber/v3/yt3/src/agents/standalone/discord_bot.ts`
- 計画出力: `/home/kafka/2511youtuber/v3/yt3/temp/plan.md`

## フォーマッター/検証

- Format: `bun run format`
- Lint: `bun run lint`
- Typecheck: `bun run typecheck`
- Harness診断: `task harness:doctor`
- Env検証: `bun run src/io/utils/check_env.ts`
- Service状態確認: `task status`

## ワークフロー

1. 実装前に `/home/kafka/2511youtuber/v3/yt3/config/.env` の必要キー存在を確認する。
2. 変更が設計判断を含む場合は `/home/kafka/2511youtuber/v3/yt3/docs/adr/` に記録する。
3. 開発前工程として候補案を比較し、採択案を `/home/kafka/2511youtuber/v3/yt3/temp/plan.md` に記録する。
4. 実装後に format/lint/typecheck を実行する。
5. `task harness:doctor` を実行し、警告を解消する。
6. `config/.env` の `DISCORD_WEBHOOK_URL` を確認し、`task up` と `task status` で通知経路を確認する。
7. 必要時は `task down` で関連サービスを停止する。
8. フック設定を変更せず、コード側を修正して整合させる。
