# Content Strategy - Memory, RAG & Continuous Improvement

## Vision
Create the highest-value financial content through intelligent topic selection, memory-driven novelty, and continuous optimization.

---

## 1. Memory Architecture

```
memory/
├── index.yaml      # Auto-indexed from runs/
└── (future)
    ├── embeddings/ # Vector search for semantic similarity
    └── feedback/   # YouTube Analytics integration
```

### Current Implementation
- **Auto-indexing**: `task memory:sync` scans all `runs/*/state.json`
- **Stored data**: topic, angle, title, keywords, date
- **Usage**: DirectorAgent injects recent topics to avoid repetition

### Best Practices
| Practice | Implementation |
|----------|---------------|
| Quality > Quantity | Store curated metadata only |
| Recency Window | 14-day lookback for novelty |
| Keyword Matching | Avoid semantic overlap with past content |

---

## 2. RAG Strategy

### Topic Selection Flow
```
News Items → DirectorAgent → [Check Memory] → Select Novel Angle → Output
                                   ↓
                            Reject if >50% overlap
                            with recent 14 days
```

### Angles (切り口)
1. **構造的** - Deep historical/economic structure
2. **逆張り** - Contrarian view, challenge mainstream
3. **未来予測** - 5-10 year forecasts
4. **点と線** - Connect unrelated events

### Selection Criteria
- **Novelty**: Must differ from recent content
- **Timeliness**: Breaking news prioritized
- **Audience Fit**: Match target keywords (金融, 経済, 投資, 株)

---

## 3. YouTube Growth Best Practices (2025-2026)

### Content Strategy
| Strategy | Implementation |
|----------|---------------|
| Niche Focus | Finance/investment - high RPM category |
| Evergreen + Timely | Mix breaking news with timeless explainers |
| First 15 Seconds | Hook viewers immediately |
| Shorts + Long-form | Shorts for reach, long-form for retention |

### Algorithm Optimization
- **SEO**: Keywords in title, description, tags
- **Thumbnails**: Bold colors, high contrast, <5 words
- **Retention**: High-retention scripts, strong pacing
- **Consistency**: Regular posting schedule

### Viral Finance Content Patterns
1. **Curiosity Gap**: "Why [X] is wrong about [Y]"
2. **Personal Stakes**: "How this affects YOUR money"
3. **Contrarian**: Challenge mainstream financial wisdom
4. **Numbers**: Specific figures ($2.1 trillion, 10x returns)

---

## 4. Continuous Improvement

### Feedback Loop (Future)
```
Publish → YouTube Analytics → Update memory/feedback/ → Adjust weights
```

### Metrics to Track
| Metric | Purpose |
|--------|---------|
| CTR | Title/thumbnail effectiveness |
| Retention | Content quality |
| Shares | Viral potential |

### Optimization Levers
1. **Prompt tuning**: Refine `prompts/director.yaml` based on performance
2. **Angle weighting**: Favor angles that historically perform well
3. **Keyword expansion**: Add high-performing keywords to target list

---

## 5. Content Diversity

### Ensure Variety
- Track angle distribution in `memory/index.yaml`
- Alert if single angle dominates (>60% of recent content)
- Rotate through all 4 angles systematically

### Topic Categories
From `config/default.yaml`:
- macro_economy, japanese_stock, us_stock
- forex_rates, commodities, crypto_web3, tech_semicon

---

## 6. Commands

```bash
# Sync memory after each run
task memory:sync

# Run full workflow
task run -- YYYY-MM-DD

# Run individual steps
task director -- latest
task publish -- latest
```

---

## 7. Future Enhancements

### Phase 2: Vector Embeddings
- Generate embeddings for each video topic
- Semantic similarity search instead of keyword matching
- Better novelty detection

### Phase 3: Analytics Integration
- Fetch YouTube Analytics via API
- Store views, CTR, retention per video
- Weight topic selection by historical performance

### Phase 4: A/B Testing
- Generate multiple title variants
- Test thumbnail variations
- Track performance and auto-select winners

### Phase 5: Interest-Based Targeting
- Leverage YouTube's 2026 interest-based ad targeting
- Target promotions based on viewer interests (2-3x engagement boost)
