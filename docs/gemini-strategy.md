# Gemini API Strategy for YT3

**Version**: 1.0  
**Last Updated**: 2026-03-27  
**Status**: ACTIVE  

## 1. Primary Model Selection

### Chosen Model: Gemini 2.5 Flash (Stable)

- **Model ID**: `gemini-2.5-flash`
- **Knowledge Cutoff**: 2024-12
- **Context Window**: 1,048,576 tokens (1M+)
- **Cost**: $0.075/1M input tokens, $0.3/1M output tokens
- **Reasoning Capability**: Medium (hybrid reasoning available via `thinking` parameter)
- **Latency**: Low (sub-second typical)

### Why Gemini 2.5 Flash?

1. **Cost/Quality Balance** — Haiku-級のコスト、Sonnet-級の capability
2. **Large Context Window** — 複数言語フィード + メモリ + プロンプトを単一リクエストで処理
3. **Native JSON Schema Support** — Type-safe structured output
4. **Hybrid Reasoning** — `thinking: true/false` で推論予算を制御可能
5. **Stable Version** — Preview ではなく、production-ready

### Fallback Strategy

**NONE** — Single LLM strategy を採用。フェイルオーバーモデルなし。  
理由: YT3 architecture は Gemini Flash に最適化済み。他モデルへの fallback は context unpacking/repacking コストが大きい。

## 2. Version Lock Policy

### Requirement: Config.yaml is the Single Source of Truth

```yaml
providers:
  llm:
    provider: "gemini"
    gemini: {model: "gemini-2.5-flash", primary_llm: "gemini-2.5-flash", ...}
```

**DO NOT:**
- Override via CLI args (e.g., `--llm-model gemini-3-flash`)
- Override via environment variables (e.g., `export GEMINI_MODEL=...`)
- Override via config merges or patches
- Load multiple model versions in same run

**RATIONALE**: config.yaml が唯一の真実源。version control + deployment時の一貫性確保。

### Upgrade Path: Preview → Stable Promotion (2-week validation)

When a new version becomes available (e.g., Gemini 3 Flash):

1. **Week 1**: Staging environment で new version test
   - Smoke tests: token count, cost, output format verify
   - A/B comparison: same prompts で output quality check
   - Rate limit behavior check

2. **Week 2**: Production canary deployment
   - 10% traffic → new version
   - Monitor: latency, error rate, cost
   - If OK: full rollout

3. **Commit**: Version bump + changelog
   ```bash
   git commit -m "feat: upgrade Gemini API to gemini-3-flash (stable)
   
   - Knowledge cutoff: 2025-01-31 (vs 2024-12)
   - Pricing: $0.10/1M input (vs $0.075), $0.4/1M output (vs $0.3)
   - Testing: Staging validation passed, canary metrics green
   - Rationale: Better reasoning capability for complex script generation
   "
   ```

## 3. Structured Output Configuration

### JSON Schema Native Support

```typescript
// Config in prompt:
const llmOptions = {
  response_mime_type: "application/json",
  response_json_schema: contentSchema, // from config/schemas/content_schema_v2.json
};
```

### Schema Versioning

- Schema files: `config/schemas/` directory
- Naming: `{domain}_schema_v{N}.json` (e.g., `content_schema_v2.json`)
- Reference in prompts: `{schema: content_schema_v2}` 
- Sync with TypeScript types: src/domain/types.ts

### Backward Compatibility

- Schema V1 (deprecated): Keep in `config/schemas/archive/` for 6 months
- Migration path: Document in `CHANGELOG.md`
- No mid-flight schema changes: Version bump on any breaking change

## 4. Cost & Quota Management

### Rate Limiting Tiers

| Tier | RPM | TPM | RPD | Upgrade Trigger |
|------|-----|-----|-----|---|
| Free | 15 | 1M | 1,500 | Active project |
| Tier 1 | 60 | 4M | 100K | $250 cap (billing setup) |
| Tier 2 | 500 | 40M | 1M | $100+ spend in 3 days |
| Tier 3 | 2000+ | 1B+ | 10M+ | $1000+ spend in 30 days |

### Batch API (Separate Quota)

- 100 concurrent requests max per batch
- Up to 2GB file size per request
- Non-latency-sensitive tasks: essence generation (nightly), trend analysis (weekly)

### Client-Side Rate Limiting

```typescript
// Implemented in src/io/utils/quota_manager.ts
- Token Bucket simulation: client-side queue with exponential backoff
- Threshold: remaining quota < 30% → activate backoff
- Max backoff: 60 seconds
- Jitter: ±10% random delay
- Metrics: logs/quota_metrics.jsonl
```

## 5. Error Handling & Loud Crashes

### Quota Exhaustion Detection

```typescript
class QuotaExhaustionError extends Error {
  constructor(context: {
    key: string;
    remaining_requests: number;
    remaining_tokens: number;
    reset_time: string;
  }) { ... }
}
```

When quota < threshold:
1. Throw `QuotaExhaustionError` (no silent fail)
2. Systemd `Restart=on-failure` triggers service restart
3. Next invocation: automatic key rotation
4. Discord alert: `#bot-alerts` channel notification

### Expected Behaviors

- **Quota hit**: Service crashes immediately with structured JSON log
- **Infrastructure handles recovery**: Systemd + key rotation
- **No try-catch in business logic**: Crashes are **observable**

## 6. Temperature Strategy by Stage

| Stage | Temperature | Think | Rationale |
|-------|--|------|---|
| Research (news filtering) | 0.5 | false | Diverse perspectives, fast |
| Selection (topic ranking) | 0.4 | false | Deterministic, quick decision |
| Script (dialogue generation) | 0.35 | optional | Balanced creativity & consistency |
| Media (layout/color) | 0.1 | false | Deterministic, minimal variance |

### Thinking Parameter Control

- **`thinking: false`** (default): Fast path, latency < 2 seconds
- **`thinking: true`**: Deep reasoning, used for complex analysis only
- Per-invocation control: pass in `callOpts` to `runLlm()`

## 7. Multimodal Future (Roadmap)

### Phase 1: Vision API Integration (Q2 2026)
- Thumbnail design analysis from video frames
- Color palette extraction from recent videos
- Text/brand element OCR from thumbnails

### Phase 2: Audio Understanding (Q3 2026)
- Speaker emotion detection for voice variation
- Background music recommendation

### Implementation

- Feature flag: `providers.llm.gemini.vision_enabled` in config.yaml
- Fallback: Graceful degradation if vision not available
- Cost: Separate vision-token metering

## 8. Monitoring & Alerting

### Metrics to Track

1. **Cost**: `data/state/gemini_costs.jsonl`
   ```json
   {"timestamp": "2026-03-27T...", "model": "gemini-2.5-flash", "input_tokens": 10000, "output_tokens": 2000, "cost_usd": 0.25}
   ```

2. **Rate Limits**: `logs/quota_metrics.jsonl`
   ```json
   {"timestamp": "...", "key": "key1", "remaining_requests": 50, "remaining_tokens": 3000000, "next_reset_seconds": 45}
   ```

3. **Latency**: `logs/agent_activity.jsonl`
   ```json
   {"stage": "research", "invocation_ms": 1250, "model": "gemini-2.5-flash", "tokens_in": 5000, "tokens_out": 1200}
   ```

### Alert Thresholds

- **Monthly cost > $50**: Slack notification
- **Quota remaining < 30%**: Auto-backoff + Discord #bot-alerts
- **Latency > 5 seconds**: Debug log (not critical)

## 9. Deprecation & Maintenance

### Monthly Review

- Check for new Gemini versions
- Review cost trends
- Validate latency SLAs
- Update knowledge cutoff awareness

### Deprecation Policy

When a model becomes deprecated:
1. Google provides 2-week notice minimum
2. YT3 team: staging test + canary
3. Full migration within 4 weeks
4. Old model completely removed from config.yaml

## 10. References & Docs

- [Gemini API Official Docs](https://ai.google.dev/gemini-api/docs)
- [Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Structured Output](https://ai.google.dev/gemini-api/docs/structured-output)
- YT3 unified conclusions: `/docs/UNIFIED_CONCLUSIONS.md`
