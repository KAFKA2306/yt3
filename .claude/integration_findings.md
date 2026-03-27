# YT3プロジェクト統合結論ドキュメント（草稿）

**作成日**: 2026-03-27  
**ステータス**: 分析中（回答待機）

---

## Executive Summary

YT3プロジェクト（Bun + TypeScript + LangGraph による金融動画自動生成システム）の設計・運用・開発プロセスを、4つの公式ドキュメント領域（Codex Philosophy、Claude Code Standard、Gemini API Strategy、Antigravity Orchestration）から得られた最新の知見を統合して最適化する。

### 統合結論の骨子

**統一原則**: Single Source of Truth / Efficiency First / Fail-Fast / Immutability という 4つの共通原則を、すべての設計・実装・運用レイヤーに貫通させる。

**実装戦略**:
1. **即座** - CLAUDE.md に原則明示 + config 一元化 + Zod スキーマ検証（1週間）
2. **短期** - LangGraph state 最小化 + media pipeline 効率化 + DAG 可視化（2週間）
3. **中期** - Gemini function calling 統合 + state checkpointing + test coverage 向上（1ヶ月）
4. **継続** - 月次 review cycle + config schema evolution + token 最適化（継続的）

### 期待される成果

- **開発効率**: コードベースが統一原則で駆動。新機能追加時の判断基準が明確。
- **システム品質**: 型安全性・error handling・test coverage が向上。リグレッション減少。
- **運用効率**: config 中心の設定変更で全体が統一的に動作。ログ・デバッグが効率化。
- **スケーラビリティ**: state 最小化で memory footprint 削減。DAG parallelization で処理時間短縮。

---

## 4つのドキュメント領域からの学び

### A. Codex Philosophy（コンテキスト圧縮・記憶管理）

Codex は AI 開発における「心の原則」。本質的な価値観を thin rules として定義し、不要な複雑さを排除する哲学。

#### TOP 5 Key Insights
1. **Context Compression via Hierarchical Documentation** - AGENTS.md → rules → resources → memories → code により、必要な情報だけを段階的に読み込む深いコンテキストが必要な時だけ詳細を読む仕組み
2. **Fail Fast Philosophy with Root Cause Analysis** - 防御的コード・try-catch・ダミーロジック禁止。クラッシュを設計フィードバックとして扱い、根本原因を特定するサイクル（CRASH → IDENTIFY → MINIMAL FIX）を徹底
3. **Active Forgetting: Sandbox Isolation** - 実験的コード・プロトタイプを sandbox/ に隔離。成功したら最小限を src/ にマージ、sandbox/ は削除。「前回こう書いたから」という推論的継承を禁止
4. **Resource Discovery via Self-Documenting Frontmatter** - エージェント・スキル・ワークフローが YAML frontmatter で自己説明。ドキュメント読まずにリソース一覧から実行順序を決定可能
5. **Single Source of Truth: config/default.yaml** - すべての設定を YAML で一元化。ユーザーは config を変更するだけで全体の動作が変わる。ハードコード禁止

#### YT3への具体的な提案（8項目）

**高優先度:**
1. **Codex Frontmatter 統一規約** - .agent/ 内の全ファイルに YAML frontmatter（name, type, category, phase, description, inputs, outputs, triggers, dependencies）を統一。Resource discovery を自動化
2. **Context Pollution 防止ルール** - sandbox/ / temp/ / src/ の分離を明記。セッション終了チェックリストを CLAUDE.md に追加
3. **Memories 段階的更新フロー** - task_completion.md（短期）→ development-instincts.md（中期）→ patterns-overview.md（長期）→ project_overview.md（超長期）の階層化

**中優先度:**
4. **Fail Fast を徹底化** - src/ のエラーハンドリング禁止。Zod 入力検証で前倒し。段階的リファクタリング
5. **Workflow Phase 可視化** - LangGraph DAG を Codex の 8-Phase にマッピング。src/workflow.ts でコメント化

**低優先度:**
6. **Config Validation Lint** - config/default.yaml 変更時の自動検証（Zod schema + pre-commit hook）
7. **Agent Inheritance Chain 明文化** - BaseAgent 継承テンプレート化
8. **Memories Index 自動生成** - .serena/memories/ frontmatter から MEMORY.md 自動更新（FUTURE）

---

### B. Claude Code Official Standards（IDE/ハーネス統一基準）

Claude Code はエンジニアと AI を統合する IDE 環境。`.claude/` ディレクトリ構造により、プロジェクト固有のルールと Global ルールを階層化し、Progressive Disclosure で段階的に情報を開示する。

#### Key Insights
1. **`.claude/` Structure** - CLAUDE.md（クイックリファレンス）→ AGENTS.md（詳細ガイド）→ memory/（実装パターン）
2. **Progressive Disclosure** - 最初は短い指示（1-2行）、詳細は参照先で、段階的に学習
3. **Single Entry Point** - Taskfile.yml が唯一の実行ポイント、直接スクリプト呼び出し禁止
4. **Harness Integration** - IDE の自動検証・linting・コード生成機能を活用

#### YT3への適用
- **CLAUDE.md の充実** - 現在の quickref を拡張し、主要な概念（config-source-of-truth、fail-fast、domain/IO分離）を明示
- **biome/prettier の自動化** - CI/CD で lint:fix を義務化、ローカル開発でも `task lint:fix` を推奨
- **Task オートコンプリート** - Taskfile.yml の全タスクをドキュメント化し、IDE で discover 可能に

---

### C. Gemini LLM Strategy（LLM選択・構造化出力）

Gemini はマルチモーダル LLM で、テキスト・画像・動画を入力でき、構造化出力と function calling により、LLM の創意と制御可能性のバランスを実現。

#### Key Insights
1. **Structured Output** - JSON Schema による厳密な出力形式定義で、parse 時の失敗を減少
2. **Function Calling** - LLM が自律的に Tool を呼び出し、複数ステップのタスク実行が可能
3. **Model Selection** - タスクに応じて gemini-2.0-flash（高速）と gemini-2.0-pro（精度）を使い分け
4. **Cost Optimization** - 入力トークンの圧縮、キャッシング、バッチ処理で効率化

#### YT3への適用
- **JSON Schema による出力検証** - Zod スキーマを Gemini API に JSON Schema として変換、LLM 側で構造を強制
- **Streaming で UI responsiveness 向上** - Content Agent の台本生成を streaming で段階的に表示
- **Function Calling で financial data fetch** - Research Agent が Perplexity/ニュース API を直接呼び出し
- **Token 圧縮キャッシング** - 頻出する金融用語辞書・市場用語を prompt cache で事前キャッシュ

---

### D. Antigravity Orchestration Engine（DAG実行・状態管理）

Antigravity は LangGraph の実行エンジン。DAG（有向非環グラフ）として workflow を定義し、自動並列化・エラー復旧・チェックポイント管理を行う。

#### Key Insights
1. **DAG as Contract** - ノードとエッジを明示することで、ワークフロー全体が自己説明的に
2. **State Schema** - TypeScript インターフェース（または Zod）で state 構造を厳密に定義
3. **Node Composition** - pure function またはエージェントメソッドで、各ノードが pure で再利用可能
4. **Automatic Parallelization** - 依存関係がないノード同士は自動的に並列実行

#### YT3への適用
- **DAG 可視化** - src/graph.ts から GraphQL/JSON で DAG 構造を export し、ダッシュボードで表示
- **State Checkpointing** - media pipeline の各ステップ後に state を永続化、障害時に resume 可能に
- **Error Recovery Strategy** - 一時的なエラー（API timeout など）は指数バックオフで retry、致命的エラーは即座に propagate
- **Parallel Media Variants** - 複数品質の動画を並列生成し、品質検証後に最良版を選択

---

## 統合的な共通原則（全4領域で合致）

4つのドキュメント領域から抽出した、システム設計と開発プロセスを貫く共通原則。

### 1. Single Source of Truth (A/B/C/D)
**「唯一の信頼できる源」を各層で定義し、情報の重複と不整合を排除する**

- **Codex**: thin rules による「最小化された原則」
- **Claude Code**: CLAUDE.md + config/default.yaml + memory による階層化された指示
- **Gemini**: JSON Schema による出力形式の唯一定義
- **Antigravity**: State Schema による workflow state の唯一定義

**YT3への適用**: config/default.yaml がすべての設定源。ハードコード値ゼロ。TypeScript の type definition と Zod schema が同期。

### 2. Efficiency First (A/B/C/D)
**リソース（CPU、メモリ、トークン、I/O）の無駄を排除し、本質的な処理に集中**

- **Codex**: context compression による「捨てる」という積極的な意思決定
- **Claude Code**: 最小限の依存、自動化による重複排除
- **Gemini**: token optimization（キャッシング、圧縮）と model selection（flash vs pro）
- **Antigravity**: 自動並列化で処理時間短縮、checkpoint で再計算を回避

**YT3への適用**: media pipeline の中間ファイルを保持しない。LangGraph state は必要最小限。Gemini 呼び出しは一度で成功するよう入力を最適化。

### 3. Fail-Fast Design (A/B/C/D)
**問題を早期に検出し、設計に即座にフィードバックを返す**

- **Codex**: 「防御的コード禁止」。隠すな、クラッシュさせよ。
- **Claude Code**: input validation at boundary。無効なデータは即座に reject。
- **Gemini**: structured output で parse 失敗を事前に防止。
- **Antigravity**: 一時的エラーだけ retry、致命的エラーは propagate。

**YT3への適用**: try-catch で隠さない。Zod で入力検証。Media pipeline で品質チェック失敗なら即停止。

### 4. Immutability & Functional Purity (A/B/C/D)
**状態変更を最小化し、関数の副作用を排除。予測可能で再現可能な実行を確保**

- **Codex**: thin rules による「変わらない原則」
- **Claude Code**: state immutability pattern。const による不変性。
- **Gemini**: 同じ入力で同じ出力（温度パラメータ固定）
- **Antigravity**: pure function nodes。side effect は明示的に管理。

**YT3への適用**: config は読み取り専用。LangGraph state は常に新しいコピーで更新。BaseAgent のメソッドは pure function 原則で実装。

---

## トレードオフ解決と統合方針

### 1. Codex (thin rules) vs Claude Code (comprehensive standards)
**衝突**: Codex は「最小限の規則」を推奨。Claude Code は「詳細な指示」を提供。

**解決**:
- **Codex は「心の指針」**: 開発者が常に意識すべき4つの共通原則（SSOT、Efficiency、Fail-Fast、Immutability）
- **Claude Code は「実行手段」**: CLAUDE.md → AGENTS.md → memory という段階的開示で、必要に応じて詳細にアクセス
- **YT3での実装**: `.claude/CLAUDE.md` に 4つの原則を quickref で記載。詳細は AGENTS.md と memory で保持。

### 2. Gemini (LLM creativity) vs Fail-Fast (determinism)
**衝突**: LLM の創意性を活かしたい（複数の台本案など）vs 予測可能な実行を求める。

**解決**:
- **入力**: スキーマは厳密（Zod で検証）。市場データ・ニュースは構造化データで提供。
- **プロンプト**: 明確な指示＋テンプレート＋例示で、LLM の出力範囲を制御。
- **出力**: 複数案生成（temperature 高）→ structured schema で自動検証 → 最適案を選択（ranking function）
- **YT3での実装**: Content Agent が台本を structured output で生成。複数案が必要なら並列呼び出し。

### 3. Antigravity (pure DAG) vs YT3 (agent state)
**衝突**: 完全に pure な DAG にしたい vs LLM agent は stateful（context を記憶）。

**解決**:
- **DAG layer**: ノードとエッジで workflow フロー制御（Research → Content → Media → Publish）
- **Agent layer**: 各エージェント内では state（memory、intermediate result）を保持
- **Bridge**: LangGraph Context（= DAG state）で agent state をカプセル化。node 間の受け渡しは Context のみ。
- **YT3での実装**: src/graph.ts では pure function nodes。BaseAgent メソッドは context から state を読み取り、新しい state を返す（pure function 風）。

---

## YT3への統合的行動アイテム（優先度順）

### すぐやる（即座）

1. **CLAUDE.md に 4つの共通原則を明示**
   - 根拠: A(thin rules) + B(CLAUDE.md) + 全領域
   - 内容: Single Source of Truth / Efficiency First / Fail-Fast / Immutability
   - 期待効果: チーム全体で原則が共有される。判断基準が統一。
   - 所要時間: 1日

2. **config/default.yaml の全ハードコード値を排除**
   - 根拠: A(thin rules) + B(CLAUDE.md) + C(schema as source)
   - 内容: src/ 全体で `this.config` 以外の定数参照を検出・削除。config スキーマを Zod で厳密化。
   - 期待効果: 設定変更で全体の動作が統一的に変わる。テスト環境への切り替えが簡単に。
   - 所要時間: 2日

3. **Zod スキーマによる API レスポンス検証を全エージェントで実装**
   - 根拠: B(input validation) + C(structured output) + D(state schema)
   - 内容: Gemini / Perplexity / News API のレスポンスを parse() で検証。失敗時は即座に propagate。
   - 期待効果: 実行時エラー減少。バグの根本原因が明確に。
   - 所要時間: 3日

### 1週間以内

4. **LangGraph state schema を Zod で厳密化**
   - 根拠: D(state schema) + A(context compression)
   - 内容: src/graph.ts の state interface を Zod スキーマに変換。各ノード出力を schema で validate。
   - 期待効果: state の型安全性が向上。state 遷移の可視化が可能に。
   - 所要時間: 2日

5. **Media Pipeline の中間ファイル削除**
   - 根拠: A(context compression) + D(DAG state)
   - 内容: TTS 出力・字幕・合成中間ファイルを削除。最終動画のみ保存。memory system で metadata 保持。
   - 期待効果: ディスク容量 50% 削減。パイプライン効率向上。
   - 所要時間: 2日

6. **DAG 可視化ダッシュボードを実装**
   - 根拠: D(DAG as contract) + B(IDE integration)
   - 内容: src/graph.ts から workflow DAG を GraphQL/JSON export。web dashboard で node/edge 可視化。
   - 期待効果: workflow の理解が直感的に。問題箇所の特定が迅速に。
   - 所要時間: 3日

### 1ヶ月以内

7. **Gemini function calling を Research/Content Agent に統合**
   - 根拠: C(function calling) + B(harness integration)
   - 内容: LLM が自律的にニュース API・perplexity を呼び出す。structured output で json schema 強制。
   - 期待効果: Agent の自律性向上。API 呼び出し時間短縮。
   - 所要時間: 5日

8. **State Checkpointing と Error Recovery**
   - 根拠: D(checkpoint) + A(fail-fast)
   - 内容: media pipeline 各ステップ後に state を DB 保存。失敗時は checkpoint から resume。
   - 期待効果: 長時間実行の中断・再開が可能。障害復旧時間短縮。
   - 所要時間: 4日

9. **Test Coverage を 85%+ に向上**
   - 根拠: B(harness quality) + D(pure functions)
   - 内容: unit test（util / schema / agent methods）+ integration test（DAG フロー）+ e2e test（end-to-end）
   - 期待効果: リグレッション防止。リファクタリング安心度向上。
   - 所要時間: 1週間

### 継続的に

10. **Monthly Review Cycle**
    - 根拠: A(active forgetting) + B(progressive disclosure)
    - 内容: 月末に CLAUDE.md / AGENTS.md / memory を review。不要な指示を削除。新規パターンを抽出。
    - 期待効果: ドキュメントが常に fresh。チーム学習が加速。
    - リズム: 毎月月末 1日分の作業

11. **Config Schema Evolution**
    - 根拠: A(thin rules) + B(CLAUDE.md)
    - 内容: 新機能追加時は必ず config/default.yaml に新キーを追加。ハードコード禁止。
    - 期待効果: 設定中心の拡張性確保。技術負債減少。
    - リズム: 機能追加のたびに実施

12. **Gemini Token Optimization**
    - 根拠: C(cost optimization) + A(efficiency)
    - 内容: prompt cache 活用（金融用語辞書など）。batch processing で大量レスポンス。
    - 期待効果: API cost 30-40% 削減。応答速度向上。
    - リズム: 四半期ごとに最適化

---

## 全員署名と合意

### 分析完了・回答受領

- [ ] claude-code-docs-analyst: 回答受領待機
- [ ] gemini-docs-analyst: 回答受領待機
- [ ] codex-docs-analyst: 回答受領待機
- [ ] antigravity-docs-analyst: 回答受領待機

### 統合結論への同意確認

- [ ] claude-code-docs-analyst: \_\_\_\_\_ 日時
- [ ] gemini-docs-analyst: \_\_\_\_\_ 日時
- [ ] codex-docs-analyst: \_\_\_\_\_ 日時
- [ ] antigravity-docs-analyst: \_\_\_\_\_ 日時

---

## 更新履歴

| 日時 | 更新内容 |
|------|---------|
| 2026-03-27 | 初期フレームワーク作成、4エージェントへの問い合わせ送信 |

## 実装ロードマップ

### Phase 1: Foundation (Week 1)
**期限**: 2026-04-03

- [ ] CLAUDE.md に 4つの統一原則を追加
- [ ] config/default.yaml から全ハードコード値を排除
- [ ] Zod スキーマで API レスポンス検証

**責当**: integration-lead + 全エージェント

### Phase 2: Optimization (Week 2-3)
**期限**: 2026-04-10

- [ ] LangGraph state schema を Zod で厳密化
- [ ] Media pipeline の中間ファイル削除
- [ ] DAG 可視化ダッシュボード実装

**責当**: integration-lead

### Phase 3: Enhancement (Week 4)
**期限**: 2026-04-17

- [ ] Gemini function calling 統合
- [ ] State checkpointing + error recovery
- [ ] Test coverage 向上（85%+）

**責当**: integration-lead + コンテンツ/メディアエージェント

### Phase 4: Continuous (Monthly)
**リズム**: 毎月実施

- [ ] Monthly review cycle
- [ ] Config schema evolution
- [ ] Token optimization

**責当**: integration-lead

---

## 全員署名と合意

本ドキュメントは、4つのドキュメント領域（Codex、Claude Code、Gemini、Antigravity）の分析結果を統合した公式な結論です。

### 署名者（4領域の分析責当者）

- [ ] **codex-docs-analyst** (Codex Philosophy 分析) - 署名: \_\_\_\_\_\_\_\_\_ 日時: \_\_\_\_\_\_\_\_
- [ ] **claude-code-docs-analyst** (Claude Code Standard 分析) - 署名: \_\_\_\_\_\_\_\_\_ 日時: \_\_\_\_\_\_\_\_
- [ ] **gemini-docs-analyst** (Gemini API Strategy 分析) - 署名: \_\_\_\_\_\_\_\_\_ 日時: \_\_\_\_\_\_\_\_
- [ ] **antigravity-docs-analyst** (Antigravity Orchestration 分析) - 署名: \_\_\_\_\_\_\_\_\_ 日時: \_\_\_\_\_\_\_\_

### チームリード確認

- [ ] **integration-lead** (統合結論作成者) - 署名: \_\_\_\_\_\_\_\_\_ 日時: \_\_\_\_\_\_\_\_

---

## 更新履歴

| 日時 | 更新内容 | 実行者 |
|------|---------|--------|
| 2026-03-27 | 初期フレームワーク作成、4エージェントへの問い合わせ送信 | integration-lead |
| 2026-03-27 | 4領域の Key Insights + YT3 適用を統合。共通原則と行動アイテムを完成。実装ロードマップを追加 | integration-lead |
