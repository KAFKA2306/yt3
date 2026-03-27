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

## 詳細ガイド
開発フロー・命名規則・エラーハンドリング等の詳細は `.serena/memories/` を参照。
