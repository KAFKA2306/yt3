# ADR Index

`docs/adr/` 配下は、テーマごとの意思決定記録（Architecture Decision Record）を管理する。

## Canonical Docs (主要意思決定ドキュメント)

- `0001-autonomous.md`: ハーネス自律運用
- `0002-harness.md`: ハーネス保守スキル導入
- `0003-crash-driven-development.md`: Crash-Driven Development（即座終了設計）
- `0004-irodori-tts-evaluation-and-usage.md`: Irodori-TTS 基盤選定と評価
- `0005-how-to-irodori-tts.md`: Irodori-TTS 音声運用レポート
- `0006-asmr-three-layer-prompt-design.md`: ASMR用3層プロンプト設計
- `0007-oneesan-onsen-care-script.md`: 温泉看病ASMR統合台本
- `0008-asmr-brand-structure.md`: 夜話アーカイブブランド構造
- `0009-kafka-visual-identity-standard.md`: ビジュアル基準とAI生成アーティファクトのクリーニング規則
- `0010-yawa-archive-asmr-publish-workflow.md`: 夜話アーカイブ投稿ワークフロー
- `0011-kafka-japanese-style-standard.md`: ライティング指針「かふからしい日本語」の採用
- `0017-character-count-based-script-management.md`: 物理的文字数（5000文字超）による台本管理
- `0018-autonomous-asmr-management-engine.md`: systemdによる自律型ASMR管理エンジン
- `0019-kafka-core-prompt-contract.md`: ビジュアル生成コアプロンプト契約
- `0020-irodori-tts-stability-protocol.md`: Irodori-TTS 話者固定・安定化プロトコル
- `0021-asmr-audition-and-archive-structure.md`: ASMR成果物管理と「オーディションルーム」運用
- `0022-autonomous-asset-archiving-and-inventory-management.md`: ASMR成果物自律アーカイブと目次自動生成
- `0023-youtube-2026-compliance-strategy.md`: YouTube 2026年コンプライアンス戦略（EDSA & AIラベル）
- `0024-youtube-thumbnail-replay-and-live-replacement.md`: 公開動画サムネイル再現とLive差し替え運用
- `0026-centralized-youtube-visibility-config.md`: YouTube公開設定集中管理
- `0027-evolution-database-schema-v2.md`: Evolution DBスキーマ更新
- `0028-audit-protocol-v1.md`: Zero-Trust Audit Protocol (Viewer Quality Assurance)
- `0029-zero-trust-voice-audit-v1.md`: Zero-Trust Voice Audit (Acoustic Integrity)
- `0030-humanity-observatory-v1.md`: 人類観測所（Humanity Observatory）システム v1
- `0031-domain-separation-standard.md`: 3チャンネルのドメイン分離・共通処理境界設計
- `0032-zero-trust-audit-charter.md`: Zero-Trust 監査アーキテクチャ憲章
- `0037-visual-reference-mirroring-and-ctr-first-thumbnail-prompting.md`: 参照画像ローカルミラーとCTR優先サムネイル方針

## Consolidated History (統合履歴)

- `archive/0012-oneesan-onsen-care-production.md` -> `0007-oneesan-onsen-care-script.md`
- `archive/0013-oneesan-onsen-care-implementation-and-verification.md` -> `0007-oneesan-onsen-care-script.md`
- `archive/0014-oneesan-onsen-care-final-optimization.md` -> `0007-oneesan-onsen-care-script.md`
- `archive/0015-multi-channel-youtube-publish-isolation.md` -> `0010-yawa-archive-asmr-publish-workflow.md`
- `archive/0016-anti-ai-aesthetic-standards.md` -> `0009-kafka-visual-identity-standard.md`
