# ADR Index

`docs/adr/` には、現在も有効な設計判断だけを置く。統合済み・obsolete な履歴は Git history で参照する。Repository-wide の agent instruction は root `AGENTS.md` が正本であり、ADRには置かない。

## Canonical Docs

- `0004-irodori-tts-evaluation-and-usage.md`: Irodori-TTS 基盤選定と評価
- `0008-asmr-brand-structure.md`: 夜話アーカイブブランド構造
- `0017-character-count-based-script-management.md`: 台本文字数管理
- `0021-asmr-audition-and-archive-structure.md`: ASMR成果物管理
- `0023-youtube-2026-compliance-strategy.md`: YouTubeコンプライアンス
- `0024-youtube-thumbnail-replay-and-live-replacement.md`: サムネイル差し替え運用
- `0027-evolution-database-schema-v2.md`: Evolution DBスキーマ
- `0028-audit-protocol-v1.md`: Zero-Trust Audit Protocol
- `0029-zero-trust-voice-audit-v1.md`: Zero-Trust Voice Audit
- `0030-humanity-observatory-v1.md`: 人類観測所
- `0031-domain-separation-standard.md`: 3チャンネルのドメイン分離
- `0032-zero-trust-audit-charter.md`: Zero-Trust監査憲章
- `0033-naming-as-security-boundary-and-path-isolation.md`: 命名による境界とパス隔離
- `0034-humanity-observatory-multi-modal-brand-audit.md`: 人類観測所のマルチモーダル監査
- `0035-voice-zero-trust-audit-spec.md`: Voice Zero-Trust Audit 仕様
- `0036-character-asset-provenance-and-integrity-standard.md`: キャラクター資産の来歴と完全性
- `0038-publish-destination-guard.md`: 投稿先取り違え防止
- `0039-humanity-cognitive-ecology-and-anti-collusion-audit.md`: 人類観測所の認知生態系監査
- `0040-qd-driven-cognitive-ecology-archive.md`: QD駆動の認知生態アーカイブ
- `0042-destructive-command-harness.md`: 破壊的コマンドの安全ハーネス
- `0043-byosan-money-zero-trust-source-policy.md`: 秒算マネーのZero-Trust情報源ポリシー
- `0045-humanity-music-video-release-gate.md`: 人類観測所の音楽動画の公開ゲート
- `0046-irodori-tts-v4-1-checkpoint-setup.md`: Irodori-TTS v4.1 のローカル導入（sandbox）
- `0047-zero-trust-artifact-attestation-and-provenance-chain.md`: Artifact attestation と provenance chain

## Rule

新しいADRは、既存ADRを更新できない場合だけ追加する。統合済み・superseded・一回限りの運用記録・現在の仕組みを説明しない提案は残さない。
