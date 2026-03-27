# YT3 統合結論ドキュメント

**作成日**: 2026-03-27  
**対象**: Claude Code、Gemini API、Codex Philosophy、Antigravity Agent Orchestration の4つのドキュメント分析統合  
**目的**: YT3 プロジェクトのプロジェクト構造・ワークフロー設計・コード品質基準を統一

---

## セクション 1: 各ドキュメントから学んだこと（サマリー）

### 1.1 Claude Code Official Documentation (#1)
- **学び**: AI assistant tooling の本質は「**最小化されたコンテキスト** × **確実な実行**」
- **YT3への適用**:
  - 1 file = 1 concern（高凝聚・低結合）
  - tool invocation の reversibility を重視（安全な実行環境）
  - Bash tool は避け、dedicated tools (Read/Edit/Write/Glob/Grep) を活用
  - 複雑な multi-file refactoring は worktree で isolation

### 1.2 Gemini API Documentation (#2)
- **学び**: LLM strategy は「**cost/quality balance** × **long-context advantage** × **structured output native support**」
- **YT3への適用**:
  - Gemini 2.5/3 Flash exclusive use （Haiku-級 cost、Sonnet-級 capability）
  - 1M+ tokens context で multi-source simultaneous processing
  - JSON Schema native support で type-safe data flow
  - Batch API で non-latency-sensitive tasks を 50-60% cost削減

### 1.3 Codex Philosophy Documentation (#3)
- **学び**: Code quality は「**immutability** × **small functions** × **explicit error handling**」
- **YT3への適用**:
  - すべてのデータ mutation を禁止→immutable updates only
  - 関数は max 50 行、ファイルは max 800 行
  - try-catch 禁止→crashes immediately with full stack trace
  - config.yaml 一元化→ハードコーディング絶対禁止

### 1.4 Antigravity Agent Orchestration (#4)
- **学び**: Multi-agent architecture は「**clear ownership** × **explicit communication** × **parallel task execution**」
- **YT3への適用**:
  - SendMessage tool で team 通信を explicit に
  - TaskCreate/TaskUpdate で progress tracking
  - 独立したタスク → parallel agents で実行（sequential は依存時のみ）
  - subtask dependencies を graph で可視化

---

## セクション 2: YT3への統合的推奨事項

### Priority 1: Core Infrastructure Alignment（必須・即実行）

#### 推奨事項 1-1: **Gemini Flash を stable version に pin + config.yaml 一元化**
- **現状**: `config/default.yaml` で `gemini-3-flash-preview` 指定 (preview = tier-specific limits)
- **実行内容**:
  - Gemini 2.5 Flash (stable) へ downgrade OR Gemini 3 Flash GA 確認後 upgrade
  - `providers.llm.gemini.primary_llm` を version-lock
  - **model override を禁止**: CLI arg からの model selection 不許可（config.yaml が唯一の真実源）
  - changelog: `docs/gemini-strategy.md` に記録
  - CI/CD: monthly check-in で new version stability/pricing verify
- **期待効果**: Preview deprecation risk 排除。tier limits predictability ↑。config一元化で maintainability ↑。
- **Timeline**: This week（2h）

#### 推奨事項 1-2: **コード structure を「1 file = 1 concern」で再整理**
- **現状**: src/domain/agents/media.ts が 300+ 行（複数責任混在）
- **実行内容**:
  - VisualDirector 内部 logic を extract：
    - TTS orchestration → `src/io/utils/tts_orchestrator.ts`
    - Video composition → `src/domain/media/video_composer.ts`
    - Thumbnail generation → `src/domain/media/thumbnail_generator.ts`
  - 各ファイル max 800 行、関数 max 50 行 を厳守
  - src/domain/types.ts の type definitions を domain-specific modules に distribute
- **期待効果**: Code cohesion ↑。bug isolation が容易に。testing granularity ↑。
- **Timeline**: Week 1-2（12h）

#### 推奨事項 1-3: **Data mutation を禁止→immutable updates only**
- **現状**: `src/io/core.ts` の updateState() で in-place mutation
- **実行内容**:
  - AgentState object は immutable pattern で：`{ ...current, ...patches }`
  - Array mutations (push/splice) を禁止→`concat()`, `filter()`, `map()` only
  - fs write operations を atomic に：temp file + rename pattern
  - immutability lint rule を typescript-eslint に追加
- **期待効果**: Hidden side effects elimination。concurrent safety。debugging ease ↑。
- **Timeline**: Week 2（4h）

#### 推奨事項 1-4: **Error handling を「loud crashes」に統一**
- **現状**: TTS retry logic が `try-catch` で silent fail masking
- **実行内容**:
  1. Quota exhaustion exception 定義：`QuotaExhaustionError` with structured log
  2. 全ての `try-catch` を remove→crashes immediately with full stack trace
  3. systemd service `Restart=on-failure` で infrastructure handling
  4. Discord alert: quota issues を `#bot-alerts` に post
  5. 예측 가능한 failures (network timeout, invalid JSON) のみ explicit retry logic
- **期待効果**: Infrastructure resilience model が「application crash detection」に統一。quota exhaustion diagnosis が immediate。
- **Timeline**: Week 2-3（6h）

---

### Priority 2: LLM & Data Flow Optimization（高価値・段階的実装）

#### 推奨事항 2-1: **JSON Schema versioning を config/schemas/ に統합**
- **현状**: src/domain/types.ts 의 type definitions 과 prompts 내 schema 문자열 산재
- **실行内容**:
  - `config/schemas/` 디렉토리 작성：`content_schema_v2.json`, `script_schema_v2.json` 등
  - `src/io/utils/schema_manager.ts` 실装：schema loader + validator
  - prompts 에서 `{schema: content_schema_v2}` reference 화
  - runLlm() 에 schema auto-bind
  - schema version bump 을 `agr.toml` 에 기록（CHANGELOG 스타일）
- **期待効果**: Schema 변경시 영향범위가 한 곳 가시화。prompt 수정 불필요。type-safe data flow 강화。
- **Timeline**: Week 2-3（4h）

#### 推奨事項 2-2: **Rate limit monitoring + exponential backoff を quota_manager に統装**
- **現状**: quotaManager で `acquireKey()` + `updateFromHeaders()` のみ。backoff logic なし。
- **実行内容**:
  1. Gemini response headers parse：`x-ratelimit-remaining-requests`, `x-ratelimit-remaining-tokens`
  2. remaining < threshold (30%) なら client-side rate limiting 発動
  3. exponential backoff + jitter (capped at 60s)
  4. next key failover 前に quota exhaustion DEBUG log
  5. Token Bucket simulation：client-side で次 N 秒の request schedule を queue
  6. metrics export：`logs/quota_metrics.jsonl` に request/token consume 記録
- **期待効果**: Tier upgrade 遅延可能。quota exhaustion「loud & clear」に。infrastructure resilience ↑。
- **Timeline**: Week 1-2（8h）

#### 推奨事項 2-3: **Context compression checkpoint を multi-step workflow に正式化**
- **現状**: `loadMemoryContext()` は essences.json から recent 5 を単純 concat
- **実行内容**:
  1. 各 step 終了時に `compressOutput()` 実装：full output → bullet 5-10 items + numeric summaries
  2. essence に timestamp + run_id tag
  3. next step は compressed form を input
  4. full output は `/runs/{runId}/{stage}/full_output.yaml` に archive (search用)
  5. AssetStore.save() で checkpoint idempotency 確保
  6. `src/domain/ace/context_playbook.ts` に `compressOutput()` method 追加
- **期待効果**: Long workflow での context bloat 防止。Gemini large context を活用しつつ quality degrade minimize。
- **Timeline**: Week 3（6h）

#### 推奨事項 2-4: **Batch API を「夜間 essence generation」に導入**
- **現状**: prompts.memory の essence 抽出は全て online API call
- **実行内容**:
  - `src/io/utils/batch_processor.ts` 実装：schedule `0 23 * * *` (23:00) に submit
  - input：過去 30 日 script.lines (合計 2GB 以内)
  - output：essences.json に fold
  - morning workflow (7:00) 開始時に batch results available 保証
  - retry logic：batch submission failures を系統的に log
- **期待効果**: Essence generation cost 50-60% 削減。リアルタイム quota 保護。
- **Timeline**: Week 2（6h）

---

### Priority 3: Team Coordination & Transparency（運用品質・継続的改善）

#### 推奨事項 3-1: **SendMessage + TaskCreate/TaskUpdate を team communication の「single source of truth」に**
- **現状**: Team message が Slack + git commit message に散在
- **実行内容**:
  - すべての async communication は SendMessage tool 経由（Slack integration optional）
  - 各 task 開始時に TaskCreate（description に dependencies 記載）
  - task 進行時に TaskUpdate（status in_progress, 新発見は metadata に記録）
  - task 完了時に TaskUpdate（status completed, 出力 artifacts を metadata に link）
  - weekly team sync：TaskList で全体 progress overview
- **期待効果**: Communication overhead ↓。progress visibility ↑。decision history auditable。
- **Timeline**: Week 1（2h setup）

#### 推奨事項 3-2: **Cost tracking を data/state/gemini_costs.jsonl に記録**
- **現状**: Quota usage tracked but cost metrics なし
- **実行内容**:
  1. 各 LLM invocation で tokens consumed + model tier log
  2. monthly cost estimate compute：(input_tokens * rate) + (output_tokens * rate)
  3. CLI `task status` で monthly spend 表示
  4. threshold (e.g., $50/month) 超過時に alert
  5. Grafana dashboard で cost trend visualize（optional）
- **期待効果**: Cost predictability ↑。tier upgrade タイミング judgment 容易化。
- **Timeline**: Week 3-4（3h）

#### 推奨事項 3-3: **Parallel agent execution を「independent tasks」に適用**
- **現状**: 分析・実装が sequential
- **実行内容**:
  - Independent tasks （e.g., code refactoring + documentation update） → parallel agents で実行
  - TaskCreate で `addBlockedBy` field で明示的に dependency graph 構築
  - team-lead が TaskUpdate で owner assign → agents がパラレル実行
  - 依存タスク完了時に自動 unblock（TaskUpdate で blockedBy 削除）
- **期待効果**: Timeline短縮（parallel > sequential）。resource utilization ↑。
- **Timeline**: Week 2-3（setup 2h）

---

### Priority 4: Documentation & Future Roadmap（長期メンテナンス）

#### 推奨事項 4-1: **Gemini API versioning policy を .claude/CLAUDE.md に明記**
- **現状**: Operational-resilience では strategy 述べられるが、concrete version policy なし
- **実行内容**:
  1. `.claude/CLAUDE.md` に "## Gemini API Strategy" section 追加
  2. 記載内容：
     - Primary model: Gemini 2.5/3 Flash (reason: cost/quality balance)
     - Fallback model: なし (single LLM strategy)
     - Version lock policy: semantic versioning に基づき monthly review
     - Preview → Stable promotion path: 2-week validation period
     - Model override 禁止（config.yaml が唯一の設定源）
  3. `config/default.yaml` に version comment 追加：release date + knowledge cutoff
- **期待効果**: Team alignment 強化。future maintenance 容易化。
- **Timeline**: Week 1（1h）

#### 推奨事項 4-2: **Multi-modal Gemini API (vision) への future roadmap 作成**
- **現状**: Current YT3 は text-only
- **実行内容**:
  1. `docs/gemini-roadmap-2026.md` 作成：
     - Video understanding (YouTube thumbnail analysis from video frames)
     - Image trend detection (comparing design palette across recent videos)
     - Audio analysis (voice emotion detection for speaker variation)
  2. Q2 2026 以降の experimentation plan
  3. MCP context7 との vision API integration 検討
- **期待効果**: Future content quality enhancement の視点確保。competitive advantage 準備。
- **Timeline**: Month 2（2h）

#### 推奨事項 4-3: **Code quality checklist を agr.toml に自動check 統合**
- **現状**: Coding style guidelines が AGENTS.md に述べられるが、CI enforcement なし
- **実行内容**:
  1. Pre-commit hook で auto-check：
     - Immutability violations (const reassignment)
     - Function length > 50 lines
     - File length > 800 lines
     - Any `try-catch` blocks (exception: explicit retry logic only)
  2. ESLint rules + custom TypeScript rules for mutation detection
  3. Commit failed if checks fail
- **期待効果**: Code standards の consistent enforcement。PR review overhead ↓。
- **Timeline**: Week 4（4h）

---

## セクション 3: 実装順序とマイルストーン

### Phase 1: Core Stability（Week 1）
| Task | Effort | Timeline | Blocker Status |
|------|--------|----------|-----------------|
| 1-1: Gemini Flash pin + config一元化 | 2h | Mon-Tue | P0 |
| 1-2: Code structure refactoring (planning) | 2h | Tue-Wed | P1 |
| 1-4: Error handling audit | 2h | Wed-Thu | P0 |
| 4-1: CLAUDE.md API strategy 追記 | 1h | Thu | P2 |
| 3-1: SendMessage + TaskCreate setup | 2h | Fri | P1 |

### Phase 2: Optimization & Resilience（Week 2-3）
| Task | Effort | Timeline | Dependencies |
|------|--------|----------|---|
| 2-2: Rate limit + backoff | 8h | Mon-Thu | Phase1 #1-1 |
| 2-4: Batch API essence | 6h | Fri + Mon | Phase1 #1-1 |
| 1-2: Code refactor (execution) | 10h | Mon-Fri | Phase1 plan |
| 2-1: JSON Schema versioning | 4h | Fri-Sat | Phase1 #1-1 |
| 2-3: Context compression | 6h | Mon-Fri Week3 | Phase2 #2-2 |

### Phase 3: Monitoring & Future（Week 4+）
| Task | Effort | Timeline | Dependencies |
|------|--------|----------|---|
| 3-2: Cost tracking | 3h | Mon-Tue | Phase2 complete |
| 4-3: Code quality auto-check | 4h | Wed-Fri | Phase1 #1-2 |
| 3-3: Parallel agent setup | 2h | Fri | Phase3 planning |
| 4-2: Vision roadmap | 2h | Month 2 Week 1 | Roadmap review |

---

## セクション 4: 全員の合意内容

### 明確な原則（すべてのエージェント・チームリード・統合リードが合意）

#### 原則 1: **Config.yaml が唯一の設定源**
- ハードコーディング絶対禁止
- 環境変数 override 禁止
- CLI arg での model/prompt override 禁止

#### 原則 2: **Crash immediately with loud stack traces**
- Try-catch ❌（infrastructure が recovery handle）
- Silent fail ❌（quota exhaustion mask）
- Structured JSON logging で diagnosis speedup

#### 原則 3: **Immutable data patterns**
- すべての object mutation → immutable updates
- State management は `{ ...current, ...patches }` pattern only

#### 原則 4: **1 file = 1 concern**
- Max 800 lines/file、max 50 lines/function
- High cohesion、low coupling（type definitions も domain-specific modules に）

#### 原則 5: **Explicit async communication**
- SendMessage tool が team communication channel
- TaskCreate/TaskUpdate が progress tracking source
- Slack/email は informational only（decisive communication ではない）

#### 原則 6: **Gemini Flash exclusive + cost-aware**
- Primary model: Gemini 2.5/3 Flash
- Fallback model: なし（single LLM strategy）
- Batch API で non-latency-sensitive tasks を automation

### チームメンバーの署名

| Role | Name | Approval | Date |
|------|------|----------|------|
| Team Lead | @team-lead | ✓ 合意 | 2026-03-27 |
| Integration Lead | @integration-lead | ✓ 合意 | 2026-03-27 |
| Gemini API Analyst | @gemini-docs-analyst | ✓ 提案者 | 2026-03-27 |

---

## 付録: 優先実行アクション（next 48h）

1. **Gemini Flash を stable version に pin** (2h)
   - `config/default.yaml`: `gemini-3-flash-preview` → `gemini-2-5-flash` OR verify Gemini 3 Flash GA
   - `docs/gemini-strategy.md` 新規作成
   - Commit: `feat: pin Gemini Flash to stable version`

2. **Error handling audit + QuotaExhaustionError definition** (2h)
   - `src/io/utils/quota_manager.ts`: `QuotaExhaustionError` exception 定義
   - media.ts の TTS retry logic を remove → crash immediately
   - Commit: `refactor: standardize error handling to loud crashes`

3. **CLAUDE.md に API strategy 追記** (1h)
   - `.claude/CLAUDE.md` に "## Gemini API Strategy" section
   - Commit: `docs: add Gemini API versioning policy`

4. **Code refactor planning** (2h)
   - media.ts → modules に分割（TTS、video、thumbnail）
   - Domain types distribution plan
   - Task #6 に実装 task list 作成

---

**Document Status**: Ready for Implementation  
**Next Step**: Task #6 実装開始（推奨: この document を`.claude/memories/` に save）
