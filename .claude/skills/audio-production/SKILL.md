---
name: audio-production
description: 日本語音声コンテンツ制作を一貫実行する統合スキル。台本正規化、TTS生成、ASR逆検品、損傷修正、最終結合までを扱う。
type: skill
---

# Audio Production

## 目的

日本語TTS/ASMR音声の制作を、意味忠実度を維持したまま再現可能に実行する。

## 必須パス

- ルート: `/home/kafka/2511youtuber/v3/yt3`
- 実行ディレクトリ: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/`
- 台本: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/script_master.md`
- 生成パーツ: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/parts/`
- ASR検品: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/asr_quality/`
- 最終音声: `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/final_mix.wav`

## フォーマッター/検証

- Markdown整形: `bun run format`
- Lint: `bun run lint`
- Typecheck: `bun run typecheck`
- 最終診断: `task harness:doctor`

## ワークフロー

1. `/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/script_master.md` を作成する。
2. 台本を章分割し、`/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/parts/` へ分割出力する。
3. TTSで章ごとに音声生成する。
4. 生成音声をASRで逆検品し、`/home/kafka/2511youtuber/v3/yt3/runs/YYYY-MM-DD/<project_id>/asr_quality/` に記録する。
5. CRITICAL/HIGH損傷のみ台本修正して再生成する。
6. `ffmpeg` で全章を結合し `final_mix.wav` を生成する。
7. 成果物のパスを固定し、再実行時に同一ディレクトリへ上書き更新する。
