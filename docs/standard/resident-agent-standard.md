---
type: "policy"
title: "YT3 Resident Agent Standard"
description: "Kafstyler の常駐エージェント規約（作業台帳・質問台帳・単一書き込みロック・冪等再開・systemd常駐）を YT3 に実装した運用正本。"
tags:
  - yt3/standard
  - yt3/operations
  - yt3/resident
aliases:
  - "常駐エージェント運用基準"
  - "resident-agent-standard"
generated:
  by: "antigravity/gemini-4-neon-high"
  at: "2026-11-20T00:52:00Z"
---

# YT3 Resident Agent Standard

端末を閉じたあとも継続稼働する常駐エージェント（`systemd --user` + `Linger=yes`）の実行入口、台帳契約、中断からの再開、および人間の回答待ちの扱いを定める。

## 1. 実行入口と常駐スケジュール（Asia/Tokyo）

| ユニット | スケジュール | 役割 | 正準コマンド |
| --- | --- | --- | --- |
| `yt3-resident-agent.timer` | 毎時 `:05`（`Persistent=true`） | L1 ベンチマーク更新、dbt マート同期、サービス健全性確認、質問台帳の更新と再開 | `task resident:tick` |
| `yt3-env-refresh.timer` | 毎時（`Persistent=true`） | 開発環境の測定・最小更新・ロールバック（[Environment Refresh Standard](environment-refresh.md)） | `task env:refresh` |
| `yt3-byosan-daily.timer` | 毎日 07:00 | 秒算マネー 日次厳選ニュース制作・公開 | `task byosan:publish-daily` |
| `yt3-yawa-daily.timer` / `yt3-yawa-validate.timer` | 月・水・金・日 20:30 / 21:15 | 夜話アーカイブ制作・公開および read-back 検証 | `task yawa:daily` / `task yawa:validate` |
| `yt3-humanity-music.timer` | 火・木・土 20:00 | 雨晴はうの人類観測所 楽曲制作・公開・再生リスト登録 | `task humanity:music-daily` |
| `yt3-analytics-refresh.timer` | 毎日 06:00 | YouTube Analytics 取得と dbt マート再構築 | `task analytics:refresh && task analytics:build` |

全ユニットの同期・有効化は `task systemd:install` で一元実行する。

## 2. 台帳契約と状態遷移

正本スキーマは [src/domain/resident/ledgers.ts](../../src/domain/resident/ledgers.ts) が所有する。

- **作業台帳（`data/state/resident/work_ledger.json`）**:
  - 識別子: `work_id`（目的単位）、`trigger_id`（予定時刻／イベント単位）、`attempt_id`（再試行単位）、`schedule` / `timezone`。
  - 状態遷移: `accepted` → `running` → `verified` / `waiting_human` / `failed` / `aborted`。
  - 再開カーソル: `completed_steps`, `next_step`, `last_verified_ref`, `external_write_keys`（外部書き込みの `dispatched` と read-back 後の `verified` を分離）。
  - 単一書き込みロック: `data/state/resident/agent.lock`（排他作成 `wx` + PID 生存確認）により同時書き込みを 1 件以下に制限する。
- **人間の回答を待つ質問台帳（`data/state/resident/question_ledger.json`）** と **ユーザ操作必須台帳（[Owner Action Ledger](owner-action-ledger.md)）**:
  - すべての自律実行の着手時に必ず開く（未作成なら質問 0 件で作成）。
  - `(target, decision_topic)` で一意化し、再実行しても同一質問を重複登録しない。
  - 状態: `open` / `answered` / `resolved_obsolete`。
  - **非ブロッキング進行**: `open` な質問に依存する工程のみ `waiting_human` で保留し、独立した工程（L1 ベンチマーク・dbt 同期など）は確認を挟まず自律で完了させる。
  - ユーザ本人が操作する項目は、Obsidian Vault 上の [Owner Action Ledger](owner-action-ledger.md)（および `task resident:ledger`）で一元管理する。
- **追記専用イベントログ（`logs/resident-agent.jsonl`）**: 起動・ロック競合スキップ・外部突合再開・完了・中止を JSONL で記録する。

## 3. 操作コマンド

```bash
# 1 サイクル実行（通常は yt3-resident-agent.timer が毎時実行）
task resident:tick

# 作業台帳・質問台帳・最新スナップショットの確認
task resident:status

# 未回答・回答済みの質問一覧を確認
task resident:questions

# オーナーの回答を記録し、次回 tick で該当工程を再開させる
task resident:answer -- <question_id> <answer_ref> "<回答内容>"

# 全 systemd ユーザータイマーの同期と起動確認
task systemd:install
```

## 4. 合格条件と自動検証（[benchmark-standard.md](benchmark-standard.md) 連動）

[tests/resident_agent.test.ts](../../tests/resident_agent.test.ts) で以下の 5 事例を自動検証する。

1. **質問 0 件の自律完了**: 両台帳を開き、質問 0 件で `verified` 到達。
2. **外部書き込み直後の中断と同一イベント再送**: 外部 read-back により二重書き込み 0 件のまま `verified` 到達。
3. **並行実行の排他**: ロック保持中の重複起動を安全にスキップし、同時書き込みを 1 件以下に制限。
4. **途中中断からの別セッション再開**: `completed_steps` を再実行せず `next_step` から再開して `verified` 到達。
5. **人間の回答待ち＋独立工程の継続＋回答後再開**: 再実行で質問が 1 件に集約され、独立工程は完了し、`answer` 記録後の次回実行で保留工程が再開して `verified` 到達。
