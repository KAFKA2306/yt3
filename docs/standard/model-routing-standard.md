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

追加料金を発生させず、かつローカル GPU（NVIDIA GeForce RTX 3060・12GB VRAM）を圧迫しないためのモデル配分と排他運用の正本。機械可読な正本定義は [config/model_routing.yaml](../../config/model_routing.yaml) に置く。

## 1. GPU 容量節約の絶対ルール（RTX 3060 12GB）

1. **常駐ローカル GPU デーモン禁止**: Ollama や vLLM 等の常駐ローカル LLM で VRAM を常時占有しない。
2. **単発起動・即解放（oneshot）**: ローカル GPU を使う処理（`yawa` の Irodori TTS、`humanity` の YuE2、今後のローカル画像モデル検証）は 1 回の生成ごとにプロセス終了で VRAM を 100% 解放する。
3. **共通 GPU 排他ロック（`~/.cache/yt3-gpu.lock`）**: `systemd/yt3-yawa-daily.service` と `systemd/yt3-humanity-music.service` は共通ロックファイルを `flock` で取得し、同時実行による OOM を物理的に防ぐ。
4. **テキスト系は VRAM 消費 0 のサブスク枠**: 雑務・監視・分類・タイトル案・ブラインド採点はすべて VRAM 0MB の `gemini-4-hydrogen-medium` / `gpt-6-luna` / `gemini-4-argon-high` / `gpt-6.1-terra` を使う。

## 2. 実疎通確認済みのゼロ追加料金ルート（2026-11-20 実測）

| 役割 | プロバイダ | モデル ID | VRAM | 状態 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 雑務・軽量 Worker / 既定ドラフト | `agy` | `gemini-4-hydrogen-medium` | 0 MB | **実疎通 OK** | `config/creative_authoring.yaml` 既定ドラフト、要約・補助処理 |
| 高速タイトル・軽量分類・実装 | `codex` | `gpt-6-luna` (`low`) | 0 MB | **実疎通 OK** | タイトル提案／批評、軽量タスク |
| 構造解析・中規模実装 | `codex` | `gpt-6.1-terra` (`medium`) | 0 MB | **実疎通 OK** | `byosan` 非クリエイティブ処理（`AGENTS.md` 準拠） |
| LLM 大エース（必要時） | `agy` | `gemini-4-neon-medium` / `high` | 0 MB | **実疎通 OK** | 高難度執筆・重要設計 |
| 独立ブラインド採点（L2） | `agy` | `gemini-4-argon-high` | 0 MB | **実疎通 OK** | `task bench:judge`（制作モデルから分離） |
| 地元音楽生成 | ローカル GPU | `YuE2` | 排他単発 | **稼働中** | `humanity` 楽曲生成 |
| 地元演技 TTS | ローカル GPU | `Irodori TTS` | 排他単発 | **稼働中** | `yawa` 固定キャスト音声 |
| 地元 CPU TTS | ローカル CPU | `VOICEVOX Nemo` | 0 MB | **稼働中** | `byosan` ナレーション |

## 3. 現時点で未対応・保留・未確認の候補

- **`gpt-6.2-sol` / `gpt-6.2-astra`**: 2026-11-20 実測で `codex` ChatGPT サブスク枠は `400 model_not_found`（アカウント対応待ち）。
- **`claude-opus-5-5` / `claude-fable-5-2` / `claude-sonnet-5-5` / `claude-haiku-5-5`**: 2026-11-20 実測で `claude` CLI はサブスク決済更新待ち（[Owner Action Ledger](owner-action-ledger.md) `OA-005`）、`agy` 側 Claude は 429 クォータ上限中。
- **`MOSS-Image`（5B）**: オープンウェイト画像候補。導入時は必ず共通 GPU ロック配下の単発起動とし、`gpt-image-2` と `benchmark` 比較してから採否を決める。
- **`DRAMA3`（35B MoE）/ `MiniMax H3` / `P-H3`**: 12GB VRAM 適合または一次仕様が `UNVERIFIED`。
- **外部有料 API（`GPT-Image-2.6` / `Suno v6` / `Seedance 2.5` / `ElevenLabs v4` / `Liquid d1.2` / `OpenCodeGo` / `CommandCode` / `Meta Muse`）**: 追加料金がかかるため未採用。
