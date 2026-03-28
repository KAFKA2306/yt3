---
name: Gemini API Phase 2 Implementation Roadmap
description: Integrated Gemini API optimization proposals for YT3 Phase 2-3
type: project
---

## High-Priority Implementations (This Week + Week 1-2)

### Task #1: Stable Version Pin (2h)
**Status**: Ready to implement
**Action**:
- Update `config/default.yaml`: Gemini 2.5 Flash → Gemini 3 Flash (if GA) or pin current stable
- Add `providers.llm.gemini.version_lock: true`
- Create `docs/gemini-strategy.md` with version policy
- CI/CD check-in: monthly version review

**Files**: 
- config/default.yaml
- docs/gemini-strategy.md
- .claude/CLAUDE.md

**Commit**: "feat: pin Gemini Flash to stable version with versioning policy"

---

### Task #2: Rate Limit + Exponential Backoff (8h)
**Status**: HIGH priority (operational stability)
**Components**:
1. Parse Gemini response headers: `x-ratelimit-remaining-requests`, `x-ratelimit-remaining-tokens`
2. Implement threshold check: trigger client-side backoff when remaining < 30%
3. Exponential backoff + jitter in quota_manager
4. Token Bucket simulation for request scheduling
5. Metrics export to `logs/quota_metrics.jsonl`

**Files**:
- src/io/utils/quota_manager.ts (extend)
- src/io/utils/backoff_scheduler.ts (new)
- src/io/core.ts (parse headers)

**Integration Points**:
- createLlm() options: add `maxRetries`, `backoffMs`
- AssetStore: add quota metrics logging

---

### Task #3: Batch API for Essence Generation (6h)
**Status**: HIGH priority (cost reduction 50-60%)
**Implementation**:
- New file: `src/io/utils/batch_processor.ts`
- Schedule: 23:00 cron job submits batch requests
- Input: last 30 days script.lines (max 2GB)
- Output: folded into essences.json
- Morning workflow (07:00) guarantees batch results ready

**Files**:
- src/io/utils/batch_processor.ts (new)
- scripts/batch_essence_cron.ts (new)
- config/default.yaml (add batch section)

**Batch Submission Format**:
```typescript
interface BatchRequest {
  custom_id: string;  // runId + scriptId
  method: "POST";
  url: "/v1beta/models/gemini-batch/generateContent";
  body: {
    model: "gemini-2.5-flash";
    contents: [{ role: "user", parts: [{ text: prompt }] }];
  };
}
```

---

## Medium-Priority Implementations (Week 2-3)

### Task #4: JSON Schema Versioning (4h)
**Status**: MEDIUM (maintainability)
**Structure**:
```
config/schemas/
├── content_schema_v2.json
├── script_schema_v2.json
├── metadata_schema_v2.json
├── director_data_schema_v2.json
└── index.json (version manifest)
```

**New File**: `src/io/utils/schema_manager.ts`
**Integration**: 
- runLlm() auto-binds schema from config/schemas/
- prompts reference `{schema: content_schema_v2}` instead of inline
- Version bump in `agr.toml` CHANGELOG

---

### Task #5: Context Compression Checkpoints (6h)
**Status**: MEDIUM (long-term quality)
**Implementation**:
1. `compressOutput()` method: full output → 5-10 bullet items + numeric summaries
2. Each step end: compress before passing to next
3. Full output archive: `/runs/{runId}/{stage}/full_output.yaml`
4. Add to `src/domain/ace/context_playbook.ts`
5. AssetStore checkpoint idempotency

**Expected Effect**: Prevent context bloat in long workflows while maintaining quality

---

### Task #6: Streaming JSON Output (4h)
**Status**: MEDIUM (latency 20-30% reduction)
**Implementation**:
- `response_mime_type: "application/json"` + streaming
- Receive script.lines incrementally
- Start TTS processing at 30% completion
- Parallel media generation
- Add `stream: true` option to LlmOptions

---

## Lower-Priority Implementations (Week 3-4)

### Task #7: Quota Error Handling (3h)
**Status**: MEDIUM (operational clarity)
**Components**:
1. `QuotaExhaustionError` class definition
2. Structured log format with run_id context
3. systemd unit: `Restart=on-failure`
4. Discord alert to `#bot-alerts` channel

---

### Task #8: Cost Tracking (3h)
**Status**: MEDIUM (financial control)
**Implementation**:
- Log per invocation: tokens_used + model_tier
- Monthly cost compute: (input_tokens * rate) + (output_tokens * rate)
- `task status` display: monthly spend + threshold alerts
- Threshold: $50/month default (configurable)

---

### Task #9: Vision API Roadmap (2h)
**Status**: LOW (future-oriented)
**Output**: `docs/gemini-roadmap-2026.md`
- Video understanding for thumbnail analysis
- Image trend detection
- Q2 2026+ experimentation plan

---

## Expected Cumulative Impact

| Metric | Current | Target | Method |
|--------|---------|--------|--------|
| Cost | 100% | 60-70% | Batch API + context compression |
| Latency | 100% | 70-80% | Streaming + backoff optimization |
| Quota efficiency | Current | +40% | Large context single requests |
| Operational visibility | Low | High | Metrics + alerts |
| Code maintainability | Medium | High | Schema versioning |

## Integration with Phase 1 Completion
- Phase 1 established: config-driven architecture, Zod validation
- Phase 2 leverages: config/schemas/ for JSON Schema centralization
- Phase 1 quota management foundation (quota_manager.ts) → Phase 2 rate limiting

## Next Immediate Actions
1. ✅ Commit quota_manager duplicate fix (004336e)
2. Fix strategy agent investment_ideas schema (blocker)
3. Implement Task #1: Stable version pin
4. Implement Task #2: Rate limit + backoff
5. Implement Task #3: Batch API framework
