# YT3 Knowledge Bundle Log

## 2026-11-20

- `docs/` を OKF v0.3 バンドルとして整備し、`docs/index.md`（`okf_version: "0.3"`）と `docs/log.md` を新設。
- 3チャンネルの新 Mission（`byosan/MISSION.md`, `yawa/MISSION.md`, `humanity/MISSION.md`）および関連指針・標準文書に統一 YAML frontmatter（`type`, `title`, `description`, `tags`, `aliases`, `generated`）を付与。
- 旧ニュース観測トーク・CQO 公開ゲート前提の `standard/humanity-observatory-audit-standard.md` を `status: deprecated`（`superseded_by: /humanity/MISSION.md`）へ移行。
- `standard/star-schema-standard.md` のリンク切れ（`ontology-standard.md`）を解消し、実装した dbt プロジェクト（`analytics/`）の `sources`・`staging`・`marts`・データテストと接続。
- `standard/ledger-standard.md` に新設の固定キャスト正本（`docs/yawa/characters.json`）、永続参照音声（`data/state/yawa/references/`）、共有世界正本（`docs/humanity/story-world.json`）、および dbt マートを追加。
- `.gitignore` から旧ルート雛形用の `SOUL.md` 指定を外し、`docs/humanity/SOUL.md` を Git 追跡対象へ復帰。
- 3チャンネルの3層評価正本 `standard/benchmark-standard.md` を新設し、`task bench:*`（決定論 L1）、`task bench:judge`（独立ブラインド採点 L2）、および dbt マート `mart_channel_growth_kpi` の `playlist_views_share_first_7d`（L3）を追加。
- Kafstyler 常駐エージェント規約を YT3 に実装し、`standard/resident-agent-standard.md`、`src/domain/resident/ledgers.ts`、`src/scripts/resident_agent.ts`、`systemd/yt3-resident-agent.{service,timer}` を追加、`yt3-env-refresh` の作業パスと `yt3-yawa-validate.timer` の曜日整合を修正。
- ユーザ操作が必須な項目を一元管理する OKF v0.3 台帳 `standard/owner-action-ledger.md` と `task resident:ledger` を新設。
- 追加料金ゼロの実疎通確認済みモデル配分（`config/model_routing.yaml`, `standard/model-routing-standard.md`）と RTX 3060 12GB 共通 GPU 排他ロック（`~/.cache/yt3-gpu.lock`）を `yt3-yawa-daily.service` / `yt3-humanity-music.service` に導入し、Claude サブスク決済待ちを `OA-005` に追記。
- プロジェクト非固有のホスト設備・GPU節約規約・全CLIモデル配分・共通スキル（`imozuru`/`yomiyasu`/`kafstyler 0.7.2`）をユーザー全体正本（`~/.gemini/config/workstation.md`, `~/.gemini/config/AGENTS.md`）へ移行し、`standard/model-routing-standard.md` を YT3 固有ルートのみへ整理。
- `kafstyler 0.7.2`（`decommission` / `canonicalize` / `reconceptualize`）に従い、未使用の旧資産（`src/domain/humanity_audit/`, `systemd/yt3-automation.{service,timer}`, `src/io/utils/infra/setup_systemd.ts`）を削除、`config/model_routing.yaml` を YT3 固有 v2 スキーマへ簡素化し、`docs/index.md` と `standard/resident-agent-standard.md` に継続運用の合格条件（一周期・運用全体）を明文化。
- `humanity` 過去 156 曲の語彙実測（`少し` 64%・`静か` 53%・`そっと` 37%）と直近歌詞の分析から、`docs/humanity/songwriting.md`・`.agents/skills/humanity-songwriting/SKILL.md`・L2 採点ルーブリック（`singable_hook_and_freshness`）を `reconceptualize` 刷新。
- `byosan` を時刻決め打ちの 2 レーンから「価格確認済みのレジーム変化（S&P/Nasdaq/SOX/VIX/日経先物）を捉えるレーン C」を含む 3 レーン方針へ `reconceptualize` 刷新し、価格確認済み事実と未確認主張（UNVERIFIED）の仕分け基準を `docs/byosan/MISSION.md` と L2 ルーブリック（`regime_shift_and_verification_split`）へ反映。
