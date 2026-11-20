---
type: "policy"
title: "YT3 Model Routing & GPU Conservation Standard"
description: "追加料金ゼロの既存サブスク CLI（Hydrogen / 6 Luna / Neon / Terra / Argon）と RTX 3060 12GB の排他・単発運用を定めるモデル配分正本。"
tags:
  - yt3/standard
  - yt3/models
  - yt3/operations
aliases:
  - "モデルルーティング正本"
  - "GPU節約方針"
  - "model-routing-standard"
generated:
  by: "antigravity/gemini-4-neon-high"
  at: "2026-11-20T10:15:00Z"
---

# YT3 Model Routing & GPU Conservation Standard

YT3（`byosan` / `yawa` / `humanity`）固有のモデル配分と GPU 排他運用の正本。機械可読な定義は [config/model_routing.yaml](../../config/model_routing.yaml) に置き、プロジェクト非固有のホスト設備・全 CLI 版・汎用ハーネス一覧はユーザー全体正本（`~/.gemini/config/workstation.md` / `~/.gemini/config/AGENTS.md`）へ委譲する。

## 1. YT3 の GPU 排他運用（RTX 3060 12GB）

1. **共通 GPU 排他ロック（`~/.cache/yt3-gpu.lock`）**: `systemd/yt3-yawa-daily.service`（Irodori TTS）と `systemd/yt3-humanity-music.service`（YuE2）は共通ロックを `flock` で取得し、単発起動・即解放で VRAM 競合を防ぐ。
2. **CPU / 0-VRAM 分離**: `byosan` の音声は CPU 版 `VOICEVOX Nemo`（port 50121）、3 チャンネルのテキスト執筆・タイトル・L2 ブラインド採点は VRAM 0MB のサブスク CLI（`agy` / `codex`）を使う。

## 2. YT3 固有ルート（`config/model_routing.yaml` 連動）

| YT3 工程 | プロバイダ | モデル ID | VRAM | 正本ファイル |
| --- | --- | --- | --- | --- |
| 3 チャンネル既定ドラフト | `agy` | `gemini-4-hydrogen-medium`（または `neon`） | 0 MB | `config/creative_authoring.yaml` |
| タイトル提案・批評 | `codex` | `gpt-6-luna` (`low`) | 0 MB | `config/creative_authoring.yaml` |
| `byosan` 非クリエイティブ解析 | `codex` | `gpt-6.1-terra` (`medium`) | 0 MB | `config/domains/byosan_money.yaml` |
| Layer 2 ブラインド採点 | `agy` | `gemini-4-argon-high` | 0 MB | `src/scripts/benchmark_judge.ts` |
| `humanity` 楽曲生成 | ローカル GPU | `YuE2` | 排他単発 | `config/music/humanity.yaml` |
| `yawa` 固定キャスト音声 | ローカル GPU | `Irodori TTS` | 排他単発 | `config/yawa/runtime.yaml` |
| `byosan` ナレーション | ローカル CPU | `VOICEVOX Nemo` | 0 MB | `config/domains/byosan_money.yaml` |

※ホスト共通の CLI 疎通結果・未対応候補・外部有料 API 判定は `~/.gemini/config/workstation.md` を参照する。
