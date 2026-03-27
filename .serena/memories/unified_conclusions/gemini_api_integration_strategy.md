# YT3 Gemini API統合戦略 - 統合結論（摘要）

## Key Principles（全員合意）

1. **Config.yaml が唯一の設定源**
   - ハードコーディング禁止、env var override 禁止、CLI arg override 禁止

2. **Crash immediately with loud stack traces**
   - Try-catch ❌（infrastructure recovery）、silent fail ❌

3. **Immutable data patterns**
   - すべての mutation は immutable updates: `{ ...current, ...patches }`

4. **1 file = 1 concern**
   - Max 800 lines/file、max 50 lines/function

5. **Explicit async communication**
   - SendMessage tool が team channel、TaskCreate/TaskUpdate が progress source

6. **Gemini Flash exclusive + cost-aware**
   - Primary: Gemini 2.5/3 Flash、Fallback なし (single LLM)
   - Batch API で non-latency-sensitive tasks automation

## Priority Implementation（Next 48h）

1. **Gemini Flash を stable version に pin** (2h)
   - config.default.yaml: gemini-3-flash-preview → gemini-2-5-flash
   - docs/gemini-strategy.md 作成

2. **Error handling audit + QuotaExhaustionError definition** (2h)
   - Media.ts の TTS retry logic remove → crash immediately

3. **CLAUDE.md に API strategy 追記** (1h)
   - Gemini versioning policy 明記

4. **Code refactor planning** (2h)
   - media.ts を modules に分割（TTS、video、thumbnail）

## Timeline

- **Phase 1 (Week 1)**: Core Stability（Gemini pin、error handling、refactor planning）
- **Phase 2 (Week 2-3)**: Optimization（rate limit backoff、batch API、context compression）
- **Phase 3 (Week 4+)**: Monitoring & Future（cost tracking、vision roadmap）

詳細は `/home/kafka/2511youtuber/v3/yt3/docs/UNIFIED_CONCLUSIONS.md` を参照。
