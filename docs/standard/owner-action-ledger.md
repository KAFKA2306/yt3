---
type: "reference"
title: "Owner Action Ledger（ユーザ操作必須台帳）"
description: "エージェント権限外のためユーザ本人の操作・判断・認証が必須な項目を一元管理する台帳。"
tags:
  - yt3/ledger
  - yt3/operations
  - yt3/owner-action
aliases:
  - "ユーザ操作台帳"
  - "オーナー対応台帳"
  - "owner-action-ledger"
generated:
  by: "antigravity/gemini-4-neon-high"
  at: "2026-11-20T00:57:00Z"
---

# Owner Action Ledger（ユーザ操作必須台帳）

エージェントには権限がない外部コンソール操作・秘密情報管理・人手レビュー／校正など、**ユーザ本人の操作が必須な項目だけ**を一元管理する正本台帳。

- **粒度**: 1 行 = 1 件のユーザ操作項目（`(target, decision_topic)` で一意。再実行で重複登録しない）
- **状態遷移**: `open`（未対応） → `done`（ユーザ操作完了・検証済み） / `obsolete`（前提変更で不要）
- **常駐エージェントとの連動**: ランタイムの自動検知項目は `data/state/resident/question_ledger.json`（[Resident Agent Standard](resident-agent-standard.md)）と `question_id` で結ばれ、条件を満たすと常駐エージェントが次回 tick で自動解消・保留工程を再開する。最新の結合一覧は `task resident:ledger` で確認できる。
- **秘密情報ルール**: トークン値・認証ファイル中身・個人連絡先は一切ここへ記録しない。

## 未完了のユーザ操作一覧（`open`）

| Action ID | Linked Question ID | 対象 (`target`) | 種別 | 状態 | 必要なユーザ操作 | 停止中の工程 | 再開・解消条件 | 確認コマンド |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `OA-001` | `q-gcp-659942893881-enable-youtube-analytics-api-380ae07d` | `gcp:659942893881` | 外部API権限 | `open` | Google Cloud Console でプロジェクト `659942893881` の **YouTube Analytics API** (`youtubeanalytics.googleapis.com`) を有効化する | Layer 3 実績データ取得（`verify_youtube_analytics_api_live_data`） | 有効化後 `task analytics:refresh` が成功し、`db/evolution.db` の `youtube_analytics` に 1 件以上入ると自動解消 | `task analytics:refresh && task analytics:build` |
| `OA-002` | `q-systemd-yt3-discord-service-rotate-discord-token-091c28ea` | `systemd:yt3-discord.service` | 秘密情報・認証 | `open` | [discord-operations](../../.agents/skills/discord-operations/SKILL.md) の手順で有効な `DISCORD_TOKEN` を設定し、`yt3-discord.service` を再起動する（現在終了コード `78/CONFIG` で停止中） | Discord Bot 常駐監視（`verify_discord_bot_service`） | `systemctl --user is-active yt3-discord.service` が `active` になると自動解消 | `systemctl --user status yt3-discord.service --no-pager` |
| `OA-003` | `manual:l2-judge-calibration` | `yt3:benchmark-l2` | 人手校正 | `open` | 新方針で生成されたランが各チャンネル 3〜5 本たまった段階で実視聴・実聴取し、良例／悪例ラベルを与えて Layer 2 採点（`task bench:judge`）の一致率を校正する | Layer 2 採点の校正ステータス（現在 `UNCALIBRATED`）および音声・歌唱の知覚品質（`UNVERIFIED`） | 校正セットで人手判定とモデル判定の一致率を記録し、`benchmark-standard.md` へ反映 | `task bench:all -- --limit=5 --with-lexicon` |
| `OA-004` | `manual:okf-human-verified` | `docs:okf-bundle` | 人手承認 | `open` | [docs/index.md](../index.md) 配下の OKF v0.3 知識文書（16 概念）を確認し、確定した文書へ `verified: [{ by: "human:<id>", at: "<ISO8601>" }]` を記録する | OKF 信頼度層（現在すべて `unverified`） | オーナー確認後に該当 Markdown の `verified` を更新 | `task resident:status` |
| `OA-005` | `manual:claude-subscription-billing` | `cli:claude` | 課金・認証 | `open` | `https://claude.ai/settings/billing` で Claude サブスクリプション決済を更新する（現在 `payment is past due` により `claude` CLI 全モデルと `yt3-env-refresh.timer` が実行不可） | `claude` CLI 経路（Opus 5.5 / Fable 5.2 / `yt3-env-refresh`） | `env -u ANTHROPIC_API_KEY claude -p "OK" --model claude-haiku-5-5` が成功すること | `env -u ANTHROPIC_API_KEY claude -p "OK" --model claude-haiku-5-5 --no-session-persistence` |

## 完了・解消済み履歴（`done` / `obsolete`）

| Action ID | 対象 | 最終状態 | 完了日 | 根拠・確認結果 |
| --- | --- | --- | --- | --- |
| — | （現在 0 件） | — | — | — |

## 運用手順

1. **一覧確認**: Obsidian で本ファイルを開くか、`task resident:ledger` を実行する。
2. **操作実施後の反映**:
   - `OA-001` / `OA-002` のような自動検知項目は、操作後に `task resident:tick`（または毎時 `:05` の自動 tick）が状態を検証して `question_ledger.json` を自動解消する。手動で回答根拠を残す場合は `task resident:answer -- <question_id> <answer_ref> "<内容>"` を使う。
   - 完了が確認できたら、本台帳の該当行を「完了・解消済み履歴」へ移す（削除せず履歴を残す）。
3. **新規項目の追加ルール**:
   - エージェントが既存の許可・代替手段・可逆な既定値で進められる作業は登録しない。
   - 本人だけが持つ認証・課金・外部コンソール権限・最終判断が必要な場合のみ 1 行追加する。
