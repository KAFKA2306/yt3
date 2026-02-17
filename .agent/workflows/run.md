---
description: 日次本番パイプラインの実行・レジューム
---

# /run — 本番実行・再開

毎日最高品質の動画を生成・投稿する。

## 新規実行
// turbo
1. サービス起動:
```bash
npx tsx scripts/tasks.ts up
```
// turbo
2. パイプライン実行:
```bash
npx tsx scripts/tasks.ts run
```

## 失敗からの再開
1. `RUN_ID`(YYYY-MM-DD)を特定。 `logs/agent_activity.jsonl` を確認。
2. `MEDIA` 失敗時は中間ファイルを削除:
```bash
rm -rf runs/[RUN_ID]/media
```
// turbo
3. 再開（レジューム）:
```bash
RUN_ID=[RUN_ID] npx tsx src/index.ts
```

> [!IMPORTANT]
> **Gemini 3 Flash** を厳守。429エラー時は今日はもう実行しない。