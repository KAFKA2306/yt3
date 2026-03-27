# Quick Reference
**詳細は AGENTS.md とメモリを参照**。ここは補足のみ。

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
