# YT3 Knowledge Bundle Log

## 2026-11-20

- `docs/` を OKF v0.3 バンドルとして整備し、`docs/index.md`（`okf_version: "0.3"`）と `docs/log.md` を新設。
- 3チャンネルの新 Mission（`byosan/MISSION.md`, `yawa/MISSION.md`, `humanity/MISSION.md`）および関連指針・標準文書に統一 YAML frontmatter（`type`, `title`, `description`, `tags`, `aliases`, `generated`）を付与。
- 旧ニュース観測トーク・CQO 公開ゲート前提の `standard/humanity-observatory-audit-standard.md` を `status: deprecated`（`superseded_by: /humanity/MISSION.md`）へ移行。
- `standard/star-schema-standard.md` のリンク切れ（`ontology-standard.md`）を解消し、実装した dbt プロジェクト（`analytics/`）の `sources`・`staging`・`marts`・データテストと接続。
- `standard/ledger-standard.md` に新設の固定キャスト正本（`docs/yawa/characters.json`）、永続参照音声（`data/state/yawa/references/`）、共有世界正本（`docs/humanity/story-world.json`）、および dbt マートを追加。
- `.gitignore` から旧ルート雛形用の `SOUL.md` 指定を外し、`docs/humanity/SOUL.md` を Git 追跡対象へ復帰。
