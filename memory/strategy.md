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

## 5. Content Diversity

### Ensure Variety
- Track angle distribution in `memory/index.yaml`
- Alert if single angle dominates (>60% of recent content)
- Rotate through all 4 angles systematically

### Topic Categories
From `config/default.yaml`:
- macro_economy, japanese_stock, us_stock
- forex_rates, commodities, crypto_web3, tech_semicon