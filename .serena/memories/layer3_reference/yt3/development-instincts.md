# YT3開発直感（14項目）

git履歴分析（50コミット）から抽出した開発パターン。

## 重要度トップ3

1. **config-source-of-truth** (信頼度98%)
   - config/default.yaml が唯一の設定源
   - ハードコード値禁止
   - ドットアクセスで取得: `this.config.agents.media.quality`

2. **base-agent-pattern** (信頼度96%)
   - すべてのエージェントが BaseAgent を継承
   - src/core.ts から共通ロジック（I/O、設定、ログ）を取得
   - コンストラクタで重複実装しない

3. **taskfile-entry-point** (信順度95%)
   - Taskfile.yml だけが実行ポイント
   - npm run / bun run / python scripts/ 直接呼び出し禁止
   - task run / task step <name> / task test で統一

## コード品質（6項目）

**fail-fast-philosophy** (95%)
- try-catch でエラーを隠さない
- 防御的ロジック（fallback、null返却）禁止
- クラッシュが設計フィードバック

**strict-type-safety** (92%)
- TypeScript strict モード必須
- any 型禁止
- Zod スキーマで全入力検証

**immutability-pattern** (88%)
- オブジェクト変更禁止
- スプレッド演算子で新規コピー
- const デフォルト、let は最小限

**minimal-code-discipline** (90%)
- 推測での抽象化禁止
- 3回以上重複で初めて抽出
- 不要コード即削除（TODO禁止）

**no-comments** (85%)
- 関数名・変数名で説明
- 必要なら関数抽出または変数改名
- AGENTS.md で設計意図のみ記載

**zod-validation-everywhere** (92%)
- すべての外部データを検証
- 境界（API応答受け取り時）で parse()
- 無検証データを domain に渡さない

## アーキテクチャ（5項目）

**domain-io-separation** (94%)
- src/domain/* ビジネスロジック のみ
- src/io/* API・ファイル・DB のみ
- 混在禁止。BaseAgent の fetchAPI() で委譲

**langgraph-workflow** (87%)
- src/graph.ts で DAG定義
- 各ノードは pure function またはエージェントメソッド
- StateManager でフロー管理
- 並列化は自動

**media-pipeline-modular** (86%)
- 5ステップ独立: 台本 → TTS → 字幕 → 合成 → 品質検証
- 各ステップは input → process → output
- 個別にテスト・デバッグ可能

**systemd-services** (83%)
- yt3-automation.service / yt3-aim.service / yt3-discord.service
- 永続バックグラウンドプロセスは systemd で
- スクリプト内の長時間実行禁止

## ワークフロー（2項目）

**commit-semantics** (91%)
- feat: / fix: / refactor: / style: / docs: / chore:
- 100% 従従規約
- ツール化・自動化可能

---

## トリガー別クイックリファレンス

| トリガー | 直感 | アクション |
|---------|------|----------|
| エラーハンドリング書いている | fail-fast | try-catch削除、エラー伝播 |
| 値をハードコード | config-source-of-truth | config/default.yaml へ |
| any 型使いたい | strict-type-safety | Zod スキーマ定義 |
| I/O ロジック domain に混在 | domain-io-separation | BaseAgent 委譲へ |
| 新規エージェント作成 | base-agent-pattern | BaseAgent 継承 |
| git コミット | commit-semantics | feat: / fix: / refactor: 使用 |
| 関数内でコメント書いてる | no-comments | 関数抽出または変数改名 |
| 状態オブジェクト変更 | immutability-pattern | スプレッド演算子で新規コピー |
| タスク実行コマンド | taskfile-entry-point | task run / task step |
| 外部 API レスポンス処理 | zod-validation-everywhere | schema.parse(data) |
| メディア生成拡張 | media-pipeline-modular | 5ステップのどれかに追加 |
| 設定値追加 | config-source-of-truth | yaml + Zod スキーマ更新 |