# yt3: 資産運用/マクロ経済動画生成システム

LangGraph.js、Gemini、Voicevox、FFmpeg を統合し、金融・マクロ経済データの観測から動画制作までを自律的に行うシステム。

## クイックスタート

依存関係のインストールと動画生成の基本手順。

```bash
task bootstrap            # 依存関係のセットアップ
task run -- "テーマ名"    # 動画生成ワークフローの実行
```

## ADR Index

設計判断は [`docs/adr/README.md`](/home/kafka/2511youtuber/v3/yt3/docs/adr/README.md) を起点に読む。親 ADR は `0001` からの連番で並べ、詳細な旧版は `docs/adr/archive/` に退避している。

## 主要コマンド

| コマンド | 内容 |
| :--- | :--- |
| `task run` | ワークフローの開始 |
| `task lint` | コードの整合性チェック |
| `task test` | 単体・結合テストの実行 |
| `task up` | 音声合成等のバックエンドサービス起動 |
| `task status` | 各サービスの稼働状況確認 |

## 安全設計

リソース保護と誤投稿防止のための制約。
- **LLMキャッシュ**: `SKIP_LLM=true` により、過去の生成データを使用してテスト可能。
- **ドライラン**: `DRY_RUN=true` がデフォルト。SNS等への自動投稿を抑制する。

## ディレクトリ構造

- `src/agents/`: 自律エージェント群
- `config/`: システム設定ファイル
- `prompts/`: LLM向けプロンプト定義
- `runs/`: 成果物および実行ログ

---
<sub>LangGraph.js • Gemini • Voicevox • FFmpeg</sub>
