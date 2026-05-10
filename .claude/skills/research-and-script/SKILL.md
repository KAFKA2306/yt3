---
name: research-and-script
description: 調査から台本化までを統合するスキル。Daily Pulse調査、NotebookLM運用、Polymarket定量分析、動画台本化を扱う。
type: skill
---

# Research And Script

## 目的

高インパクト事象を数値付きで収集し、分析と台本へ変換する。

## 必須パス

- ルート: `/home/kafka/2511youtuber/v3/yt3`
- リサーチ出力: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/research.md`
- 台本出力: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/script_master.md`
- メタデータ: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/youtube_metadata.md`
- NotebookLM設定: `/home/kafka/2511youtuber/v3/yt3/config/default.yaml`
- NotebookLM出力: `/home/kafka/2511youtuber/v3/yt3/runs-nlm/`
- 定量分析ログ: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/`

## フォーマッター/検証

- Format: `bun run format`
- Lint: `bun run lint`
- Typecheck: `bun run typecheck`
- 検証: `bun run verify:scenario`
- API検証: `bun run verify:api`

## ワークフロー

1. 当日ソースを収集し、主張ごとに数値・URL・ISO8601時刻を対応付ける。
2. `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/research.md` に事実のみ記録する。
3. 市場データを抽出し、`p_model` と `edge` を算出して優先度を決める。
4. `config/default.yaml` を読み込み、`notebooklm list --json` で対象ノートを取得する。
5. NotebookLM生成物を `/home/kafka/2511youtuber/v3/yt3/runs-nlm/` に保存する。
6. 最大インパクト事実を選定し、`script_master.md` へ台本化する。
7. `youtube_metadata.md` を生成する。
