# ADR Index

`docs/adr/` には、現在も運用判断に使う主要な Architecture Decision Record だけを置く。統合済み・obsolete な履歴は Git history で参照する。

## Canonical Docs

- `0001-autonomous.md`: ハーネス自律運用
- `0002-harness.md`: ハーネス保守スキル導入
- `0003-crash-driven-development.md`: Crash-Driven Development
- `0004-irodori-tts-evaluation-and-usage.md`: Irodori-TTS 基盤選定と評価
- `0005-how-to-irodori-tts.md`: Irodori-TTS 音声運用
- `0006-asmr-three-layer-prompt-design.md`: ASMR用3層プロンプト設計
- `0007-oneesan-onsen-care-script.md`: 温泉看病ASMR統合台本
- `0008-asmr-brand-structure.md`: 夜話アーカイブブランド構造
- `0009-kafka-visual-identity-standard.md`: ビジュアル基準
- `0011-kafka-japanese-style-standard.md`: ライティング指針
- `0017-character-count-based-script-management.md`: 台本文字数管理
- `0018-autonomous-asmr-management-engine.md`: ASMR自律管理
- `0019-kafka-core-prompt-contract.md`: ビジュアル生成コアプロンプト契約
- `0020-irodori-tts-stability-protocol.md`: Irodori-TTS安定化
- `0021-asmr-audition-and-archive-structure.md`: ASMR成果物管理
- `0022-autonomous-asset-archiving-and-inventory-management.md`: ASMRアーカイブ管理
- `0023-youtube-2026-compliance-strategy.md`: YouTubeコンプライアンス
- `0024-youtube-thumbnail-replay-and-live-replacement.md`: サムネイル差し替え運用
- `0027-evolution-database-schema-v2.md`: Evolution DBスキーマ
- `0028-audit-protocol-v1.md`: Zero-Trust Audit Protocol
- `0029-zero-trust-voice-audit-v1.md`: Zero-Trust Voice Audit
- `0030-humanity-observatory-v1.md`: 人類観測所
- `0031-domain-separation-standard.md`: 3チャンネルのドメイン分離
- `0032-zero-trust-audit-charter.md`: Zero-Trust監査憲章
- `0037-visual-reference-mirroring-and-ctr-first-thumbnail-prompting.md`: CTR優先サムネイル方針
- `0038-publish-destination-guard.md`: 投稿先取り違え防止

## Rule

新しいADRは、既存ADRを更新できない場合だけ追加する。統合済み・superseded・一回限りの運用記録は残さない。
