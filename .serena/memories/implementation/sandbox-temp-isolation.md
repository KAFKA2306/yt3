## Context Pollution Prevention - sandbox/temp 規約化実装

**実装日**: 2026-03-27

### 実装内容

1. **ディレクトリ構造構築**
   - `sandbox/experiments/` - AI 生成コード、一回限りのスクリプト
   - `sandbox/prototypes/` - プロトタイプ実装レビュー用
   - `temp/builds/` - ビルド成果物、キャッシュ
   - `temp/logs/` - ランタイムログ、診断情報

2. **ドキュメント作成**
   - `sandbox/README.md`: 実験隔離の目的と原則
   - `temp/README.md`: 一時ファイルの目的と構成

3. **.gitignore 設定**
   - `.gitignore` に既に `sandbox/` `temp/` `*.generated` を記載
   - git は sandbox 内のファイル（README.md を含む）を自動無視
   - これにより Context Pollution を完全に防止

### 原則
- 実験的コードは sandbox 配下のみに記述
- sandbox コードを src/ に import しない
- 定期的にクリーンアップ: `rm -rf sandbox/* temp/*`
- 構造上、git には一切履歴が保存されない
