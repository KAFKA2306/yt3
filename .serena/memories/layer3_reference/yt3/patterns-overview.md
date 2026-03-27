# YT3 Patterns: AI Video Generation Workflow

YT3は、Bun + TypeScript + LangGraphで構築されたAI駆動の金融動画自動生成システム。マーケットデータから動画化までを統一ワークフローで実行。

## 主要アーキテクチャ

**Domain/I/O分離**:
- `src/domain/*` - ビジネスロジック（エージェント、判断、変換）
- `src/io/*` - 外部連携（API、ファイル、DB）

**BaseAgent パターン**: すべてのエージェントが `BaseAgent` (src/core.ts) を継承。設定・I/O・状態管理を集約。

**設定一元化**: `config/default.yaml` がすべての設定源。ハードコード禁止。

## 開発哲学

**Fail Fast**: 防御的コード禁止。クラッシュが設計フィードバック。try-catchで隠さない。

**イミュータビリティ**: オブジェクト変更禁止。常に新しいコピーを返す。

**最小コード**: 推測による抽象化禁止。3回以上の重複で初めて抽出。

## ワークフロー

**LangGraph DAG**:
```
Research → Content → Media → Publish
                ↓
            MemoryAgent (並列)
```

**メディアパイプライン** (5段階):
1. スクリプト生成（Gemini）
2. 音声合成（VOICEVOX）
3. 字幕生成（SRT形式）
4. 動画合成（FFmpeg + Sharp）
5. 品質検証（IQA）

## コミット規約

- `feat:` 新機能・ワークフローステップ
- `fix:` バグ・セキュリティ修正
- `refactor:` 振る舞い不変の再編成
- `style:` フォーマット・Biome対応
- `docs:` ドキュメント更新
- `chore:` ビルド・依存・自動化

## テスト戦略

TDD（テスト先行）。カバレッジ≥80%。

- `tests/core.test.ts` ユーティリティ・設定
- `tests/agents/` 各エージェント
- `tests/fixtures/` 再利用可能なテストデータ

## 型安全性

- TypeScript `strict` モード
- Zodスキーマで入力検証
- No `any` types
- 外部データは境界で検証

## 運用

- **Taskfile.yml**: 唯一のエントリーポイント。直接スクリプト実行禁止。
- **Systemd**: yt3-automation.service / yt3-aim.service / yt3-discord.service
- **ファイルサイズ**: Agents <500 LOC、Utils <300 LOC

## 主要依存

| 依存 | 用途 |
|-----|------|
| @langchain/langgraph | ワークフロー DAG実行 |
| gemini-api | LLM（リサーチ・台本） |
| voicevox | TTS（日本語音声） |
| ffmpeg | 動画合成 |
| sharp | 画像処理 |
| zod | スキーマ検証 |
| discord.js | ボット通知 |