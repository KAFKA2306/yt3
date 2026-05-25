# ADR-0043: Byosan Money Zero-Trust Source Policy

## Status

Accepted

## Context

秒算マネーは「ニュース要約チャンネル」ではなく、「一次情報ベースの世界状態変数観測システム」として運用される必要がある。

そのため、単発ニュース要約、煽り、断定未来予測、出典不明のグラフを排除し、Tier 1 source を最優先にする機械判定可能な契約が必要になった。

## Decision

`config/domains/byosan_money.yaml` に `source_policy` を追加し、Tier 1 source list, forbidden_patterns, required_state_variables を単一の構造にまとめる。

同時に、以下を追加する。

- `config/schemas/byosan_money_source_policy_v1.json`
- `config/schemas/byosan_money_content_audit_v1.json`
- `scripts/audit_byosan_money_zero_trust.ts`
- `.claude/agents/liquidity-regime-agent.md`
- `.claude/agents/humanity-impact-agent.md`

## Consequences

- 各主張は source_tier と URL または source_identifier を持つ必要がある。
- 各コンテンツは liquidity / fiscal / rates / productivity / AI capex / energy / supply chain / geopolitical_regime のうち最低3つ以上に接続する必要がある。
- 最後に生活影響への接続がない出力は監査で落ちる。

## Verification

`bun x tsc --noEmit`

`bun x biome check .`

`bun run audit:byosan-money`

