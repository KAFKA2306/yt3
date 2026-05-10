---
name: publish-operations
description: 配信工程を管理するスキル。メタデータ最終確認、成果物確認、公開前検証、公開処理を扱う。
type: skill
---

# Publish Operations

## 目的

動画公開工程を再現可能に実行する。

## 必須パス

- ルート: `/home/kafka/2511youtuber/v3/yt3`
- 実行ディレクトリ: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/`
- 動画成果物: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/final_video.mp4`
- メタデータ: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/youtube_metadata.md`

## フォーマッター/検証

- Format: `bun run format`
- Lint: `bun run lint`
- Typecheck: `bun run typecheck`
- 最終診断: `task harness:doctor`

## ワークフロー

1. `final_video.mp4` と `youtube_metadata.md` の存在を確認する。
2. タイトル、説明、タグ、公開設定を最終確認する。
3. 公開前検証を実行する。
4. 配信処理を実行する。
5. 実行ログを run ディレクトリへ保存する。
