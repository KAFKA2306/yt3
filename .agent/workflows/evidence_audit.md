---
name: evidence_audit
description: エビデンスの誠実性とデータの不自然さ（偽装）を検知・監査するための「守り」の標準プロトコル。
---

# Evidence Audit: 高忠実度エビデンス監査標準

本スキルは、投資戦略の検証プロセスにおいて「不自然なデータ（Mocked/Hardcoded Data）」を排除し、`GEMINI.md` に掲げる **"Immutable Evidence"** を保証するための監査基準を定義する。

## 1. 監査対象：データの不自然さ (Unnaturalness)

以下のパターンを「データの不自然さ」として検知し、実運用への投入を棄却（Reject）する。

### 1.1 ハードコード・メトリクス (Potemkin Metrics)
- **検知条件**: `Sharpe Ratio`, `Annualized Return`, `t-Stat` 等の KPI が、バックテスト履歴から算出されず、スクリプト内で直接数値（リテラル）として代入されている。
- **<td>是正アクション**: `simulator.ts` または `QuantMetrics` を使用し、観測されたリターン系列から動的に算出するよう強制する。

### 1.2 言語的ヒューリスティックによる採点 (Linguistic Fraud)
- **検知条件**: 戦略の「妥当性（Reasoning Score）」が、経済論理の検証ではなく、説明文中のキーワード検索（Regex）のみで決定されている。
- **是正アクション**: 言語的スコアを「Linguistic Plausibility（論理的もっともらしさ）」に格下げし、最終的な信頼性はバックテストの統計的有意性（P-Value/IC）を主軸とする。

### 1.3 証拠系譜の断絶 (Lineage Break)
- **検知条件**: Outcome（結果報告）の UUID またはハッシュが、UQTL (Unified Quantum Task Ledger) のイベントログと一致しない。
- **是正アクション**: 全ての検証ステップで `MemoryCenter.pushEvent` を実行し、フロントエンドでの結合（Evidence Bonding）を担保する。

## 2. 実装時の遵守ルール

1. **実データ強制原則**: 実験ファイル（`experiments/*.ts`）であっても、可能な限り `YahooFinanceGateway` 等から最新の市場データを取得して検証を行うこと。
2. **証拠ソースの明示**: 全ての `StandardOutcome` に `evidenceSource` プロプロパティ（`QUANT_BACKTEST` | `LINGUISTIC_ONLY`）を付与し、フロントエンドに透過的に伝えること。
3. **棄却の誠実性**: 統計的に有意でない結果（P-Value > 0.05 等）を無理に「合格」させず、誠実に「棄却（FAILED）」として記録すること。

## 3. 推奨ツール・コマンド

- `task check`: コード内の不自然なリテラル配置（特に `0.85` や `1.85` 等の固定報酬値）を静的解析と目視の両面で点検する。
- `api_server.ts`: UQTL イベントログを API 経由で取得し、Outcome との整合性をクロスリファレンスする。

---
*Authorized by the Antigravity Autonomous Alpha Factory.*
