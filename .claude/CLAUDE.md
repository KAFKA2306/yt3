# Quick Reference
**詳細は AGENTS.md とメモリを参照**。ここは補足のみ。

## 統一原則（全領域で共通）

YT3 システム全体を駆動する 4つの基本原則。すべての設計・実装・運用判断はこれを根拠に行う。

1. **Single Source of Truth** — 唯一の信頼できる源を各層で定義。config/default.yaml が全設定の源。ハードコード禁止。
2. **Efficiency First** — リソース（CPU、メモリ、トークン）の無駄を排除。context compression、並列化、token optimization。
3. **Fail-Fast Design** — 問題を早期に検出。防御的コード禁止。Zod で入力検証。エラーは即座に propagate。
4. **Immutability & Functional Purity** — 状態変更を最小化。const、新しいコピー、pure function で副作用ゼロ。

**詳細は `.claude/integration_findings.md` を参照。**

## ビルド・実行
```bash
task build       # TypeScript コンパイル
task start       # メインワークフロー実行
task dev         # 開発モード
task test        # テスト実行
task lint:fix    # リント自動修正
```

## 構造ルール
- `src/domain/*` - ビジネスロジック
- `src/io/*` - 外部連携（API、ファイル）
- `config/default.yaml` - 唯一の設定源
- `Taskfile.yml` - 実行の単一エントリーポイント

## コード品質
- TypeScript: `strict` モード（`any` 禁止）
- Zod による入力スキーマ検証
- コメント最小限（自己説明的コード）
- 高階関数・デコレータで横断的関心事を共有

## Gemini API Strategy
- **Primary Model**: Gemini 2.5 Flash（安定版）
- **Config Source**: `config/default.yaml` の `providers.llm.gemini.model` が唯一の真実源
- **Override禁止**: CLI args、env vars、config merges からの上書き不許可
- **Upgrade Path**: 新版は GA のみ、2週間 staging 検証後に config 更新
- **詳細**: `docs/gemini-strategy.md` 参照

## 詳細ガイド
開発フロー・命名規則・エラーハンドリング等の詳細は `.serena/memories/` を参照。
